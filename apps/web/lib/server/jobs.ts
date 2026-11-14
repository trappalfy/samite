// Reads from the index (packages/db), shaped for the API and the app pages. Amounts are base-unit strings in JSON;
// the browser re-checks status and hashes against the chain (§12), so nothing here is the last word on money.
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from "drizzle-orm"
import { splitReward } from "@samite/config/money"
import { schema, type Db } from "@samite/db"
import { ApiError } from "./errors"

const { jobs, specs, posters, events, machines, rejections } = schema
export type JobRow = typeof jobs.$inferSelect

export const displayNo = (n: number) => String(n).padStart(4, "0")

/** `:ref` is a display number ("0415", "415") or a job address. */
export function parseRef(ref: string): { no: number } | { pda: string } {
  if (/^\d{1,9}$/.test(ref)) return { no: Number(ref) }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref)) return { pda: ref }
  throw new ApiError("not_found", `No job ${ref}.`)
}

/** A job by reference; an address re-used after its job closed names its latest job. Hidden jobs only on request. */
export async function findJob(db: Db, ref: string, o: { includeHidden?: boolean } = {}): Promise<JobRow> {
  const r = parseRef(ref)
  const where = "no" in r ? eq(jobs.displayNo, r.no) : eq(jobs.pda, r.pda)
  const [j] = await db.select().from(jobs).where(where).orderBy(desc(jobs.displayNo)).limit(1)
  if (!j || (j.hidden && !o.includeHidden)) throw new ApiError("not_found", `No job ${ref}.`)
  return j
}

export function jobView(j: JobRow, spec?: { title: string | null; category: string | null } | null) {
  const { toMachine, fee } = splitReward(j.reward, j.feeBps)
  return {
    no: displayNo(j.displayNo),
    display_no: j.displayNo,
    pda: j.pda,
    status: j.status,
    poster: j.poster,
    posted_from: j.postedFrom,
    worker: j.worker,
    title: spec?.title ?? null,
    category: spec?.category ?? null,
    reward: j.reward.toString(),
    fee_bps: j.feeBps,
    to_machine: toMachine.toString(),
    fee: fee.toString(),
    deadline: Number(j.deadline),
    review_window: j.reviewWindow,
    claim_window: j.claimWindow,
    policy: j.policy,
    allowlist: j.allowlist,
    deliveries: j.deliveries,
    delivery_hash: j.deliveryHash,
    spec_hash: j.specHash,
    created_at: Number(j.createdAt),
    claimed_at: j.claimedAt === null ? null : Number(j.claimedAt),
    delivered_at: j.deliveredAt === null ? null : Number(j.deliveredAt),
    closed_at: j.closedAt === null ? null : Number(j.closedAt),
    posted_slot: Number(j.postedSlot),
    updated_slot: Number(j.updatedSlot),
  }
}
export type JobView = ReturnType<typeof jobView>

export type BoardQuery = {
  status?: string
  category?: string
  postedFrom?: string
  minReward?: bigint
  sort?: "newest" | "reward" | "deadline"
  cursor?: string
  limit?: number
  /** My jobs: what an address posted, or works on. */
  poster?: string
  worker?: string
}

const STATUSES = ["open", "claimed", "delivered", "paid", "refunded", "cancelled"] as const

/** The board (§6.1): only jobs whose spec is stored, re-hashes to the chain and passed moderation (`hidden = false`). */
export async function board(db: Db, q: BoardQuery) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 100)
  const sort = q.sort ?? "newest"
  const status = q.status ?? "open"
  if (status !== "all" && !STATUSES.includes(status as never))
    throw new ApiError("bad_request", `status is one of ${STATUSES.join(", ")} or all.`)
  const where: SQL[] = [eq(jobs.hidden, false)]
  if (status !== "all") where.push(eq(jobs.status, status as (typeof STATUSES)[number]))
  if (q.category) where.push(eq(specs.category, q.category.toLowerCase()))
  if (q.postedFrom) {
    if (q.postedFrom !== "app" && q.postedFrom !== "api")
      throw new ApiError("bad_request", "posted_from is app or api.")
    where.push(eq(jobs.postedFrom, q.postedFrom))
  }
  if (q.minReward !== undefined) where.push(sql`${jobs.reward} >= ${q.minReward.toString()}::numeric`)
  if (q.poster) where.push(eq(jobs.poster, q.poster))
  if (q.worker) where.push(eq(jobs.worker, q.worker))

  // keyset pagination: the cursor is the last row's sort key and number
  if (q.cursor) {
    let c: { k: string; n: number }
    try {
      c = JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8"))
      if (typeof c.n !== "number" || typeof c.k !== "string") throw new Error()
    } catch {
      throw new ApiError("bad_request", "cursor is not one this API gave out.")
    }
    if (sort === "newest") where.push(lt(jobs.displayNo, c.n))
    if (sort === "reward") where.push(sql`(${jobs.reward}, ${jobs.displayNo}) < (${c.k}::numeric, ${c.n})`)
    if (sort === "deadline") where.push(sql`(${jobs.deadline}, ${jobs.displayNo}) > (${c.k}::bigint, ${c.n})`)
  }
  const order =
    sort === "reward"
      ? [desc(jobs.reward), desc(jobs.displayNo)]
      : sort === "deadline"
        ? [asc(jobs.deadline), asc(jobs.displayNo)]
        : [desc(jobs.displayNo)]

  const rows = await db
    .select({ job: jobs, title: specs.title, category: specs.category, record: posters })
    .from(jobs)
    .innerJoin(specs, eq(specs.specHash, jobs.specHash))
    .leftJoin(posters, eq(posters.address, jobs.poster))
    .where(and(...where))
    .orderBy(...order)
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const next =
    rows.length > limit && last
      ? Buffer.from(
          JSON.stringify({
            k: (sort === "reward" ? last.job.reward : last.job.deadline).toString(),
            n: last.job.displayNo,
          }),
        ).toString("base64url")
      : null
  return {
    jobs: page.map((r) => ({ ...jobView(r.job, r), poster_record: posterView(r.job.poster, r.record) })),
    next_cursor: next,
  }
}

export function posterView(address: string, p: typeof posters.$inferSelect | null | undefined) {
  return {
    address,
    posted: p?.posted ?? 0,
    paid: p?.paid ?? 0,
    refunded_after_delivery: p?.refundedAfterDelivery ?? 0,
    rejections: p?.rejections ?? 0,
    cancelled: p?.cancelled ?? 0,
  }
}

export async function posterRecord(db: Db, address: string) {
  const [p] = await db.select().from(posters).where(eq(posters.address, address))
  return posterView(address, p)
}

export function eventView(e: typeof events.$inferSelect) {
  return {
    id: e.id,
    job: displayNo(e.jobNo),
    pda: e.jobPda,
    kind: e.kind,
    actor: e.actor,
    amount: e.amount?.toString() ?? null,
    fee: e.fee?.toString() ?? null,
    slot: Number(e.slot),
    sig: e.sig,
    at: Number(e.at),
  }
}

/** One job's full public record: spec, poster record, events, and the public rejection reasons (§4.6). */
export async function jobDetail(db: Db, ref: string) {
  const j = await findJob(db, ref)
  const [spec] = await db.select().from(specs).where(eq(specs.specHash, j.specHash))
  const history = await db
    .select()
    .from(events)
    .where(eq(events.jobNo, j.displayNo))
    .orderBy(asc(events.slot), asc(events.ix))
  const reasons = await db
    .select()
    .from(rejections)
    .where(and(eq(rejections.jobNo, j.displayNo), sql`${rejections.sig} is not null`))
    .orderBy(asc(rejections.attempt))
  return {
    job: jobView(j, spec),
    spec: spec?.json ?? null,
    poster_record: await posterRecord(db, j.poster),
    events: history.map(eventView),
    rejections: reasons.map((r) => ({
      attempt: r.attempt,
      reason: r.reason,
      reason_hash: r.reasonHash,
      sig: r.sig,
      at: Number(r.at),
    })),
  }
}

/** The live feed (§6.1): events of visible jobs, oldest first after `cursor` (an event id), or the newest page. */
export async function feed(db: Db, o: { after?: number; limit?: number }) {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 200)
  const visible = and(eq(jobs.hidden, false), eq(jobs.displayNo, events.jobNo))
  const base = db.select({ e: events }).from(events).innerJoin(jobs, visible)
  const rows =
    o.after === undefined
      ? (await base.orderBy(desc(events.id)).limit(limit)).reverse()
      : await base.where(gt(events.id, o.after)).orderBy(asc(events.id)).limit(limit)
  const out = rows.map((r) => eventView(r.e))
  return { events: out, cursor: out.at(-1)?.id ?? o.after ?? 0 }
}

export async function machineRecord(db: Db, address: string) {
  const [m] = await db.select().from(machines).where(eq(machines.address, address))
  const worked = await db
    .select({ job: jobs, title: specs.title, category: specs.category })
    .from(jobs)
    .leftJoin(specs, eq(specs.specHash, jobs.specHash))
    .where(and(eq(jobs.worker, address), eq(jobs.hidden, false)))
    .orderBy(desc(jobs.displayNo))
    .limit(100)
  return {
    address,
    label: m?.label ?? null,
    accepted: m?.accepted ?? 0,
    rejected: m?.rejected ?? 0,
    earned: (m?.earned ?? 0n).toString(),
    first_seen: m ? Number(m.firstSeen) : null,
    last_paid_at: m?.lastPaidAt ? Number(m.lastPaidAt) : null,
    history: worked.map((r) => jobView(r.job, r)),
  }
}

/** Landing numbers (§6.1): open jobs, USDC in escrow, paid in 24 h, jobs settled per hour over 24 h. */
export async function stats(db: Db, nowSec: number) {
  const since = BigInt(nowSec - 86_400)
  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.status, "open"), eq(jobs.hidden, false)))
  // escrow is money on-chain whatever moderation said, so hidden jobs count here
  const [escrow] = await db
    .select({ v: sql<string>`coalesce(sum(${jobs.reward}), 0)::text` })
    .from(jobs)
    .where(isNull(jobs.closedAt))
  const settled = and(inArray(events.kind, ["paid", "auto_released"]), sql`${events.at} > ${since.toString()}::bigint`)
  const [paid] = await db
    .select({ v: sql<string>`coalesce(sum(${events.amount}), 0)::text` })
    .from(events)
    .where(settled)
  const hours = await db
    .select({
      h: sql<number>`floor((${events.at} - ${since.toString()}::bigint) / 3600)::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(settled)
    .groupBy(sql`1`)
  const perHour = Array.from({ length: 24 }, (_, i) => hours.find((h) => h.h === i)?.n ?? 0)
  return {
    open_jobs: open?.n ?? 0,
    usdc_in_escrow: escrow?.v ?? "0",
    paid_24h: paid?.v ?? "0",
    jobs_per_hour: perHour,
    as_of: nowSec,
  }
}

/** Accepted jobs per UTC day for the activity grid (26 weeks × 7 days, oldest first): payouts the machine received. */
export async function machineDays(db: Db, address: string, nowSec: number, days = 182): Promise<number[]> {
  const today = Math.floor(nowSec / 86_400)
  const since = BigInt((today - days + 1) * 86_400)
  const rows = await db
    .select({ d: sql<number>`floor(${events.at} / 86400)::int`, n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(
        eq(events.actor, address),
        inArray(events.kind, ["paid", "auto_released"]),
        sql`${events.at} >= ${since.toString()}::bigint`,
      ),
    )
    .groupBy(sql`1`)
  const out = new Array<number>(days).fill(0)
  for (const r of rows) out[r.d - (today - days + 1)] = r.n
  return out
}

/** The machines list: most accepted first. */
export async function topMachines(db: Db, limit = 50) {
  const rows = await db.select().from(machines).orderBy(desc(machines.accepted), desc(machines.earned)).limit(limit)
  return rows.map((m) => ({
    address: m.address,
    label: m.label,
    accepted: m.accepted,
    rejected: m.rejected,
    earned: m.earned,
  }))
}
