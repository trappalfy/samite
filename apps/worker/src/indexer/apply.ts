// Applies one transaction's events to the index (CLAUDE.md §7.2, §8). The chain is the source of truth: every row
// here is derived from events, carries the slot it was read at, and a transaction is applied at most once
// (its events are keyed by (signature, index), and everything it changes is written in one database transaction).
import { and, eq, isNull, sql } from "drizzle-orm"
import { schema, type Db } from "@samite/db"
import type { EventKind, JobStatus, Policy } from "@samite/db/schema"
import { sha256, toHex } from "@samite/formats"
import type { ReadonlyUint8Array } from "@solana/kit"
import type { ClaimPolicy, DecodedEscrowEvent } from "@samite/program-client"
import { DELIVERY_RETENTION_SEC } from "@samite/storage"

const { events, jobs, machines, posters, specs, deliveries, rejections, indexerState } = schema
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export type IndexedTransaction = { sig: string; slot: bigint; events: DecodedEscrowEvent[] }

/** The indexer's place in the chain, written in the same database transaction as what it applied. */
export const CURSOR_KEY = "escrow"

const hex = (b: ReadonlyUint8Array) => toHex(Uint8Array.from(b))

/** JSON for `events.data`: bigints as decimal strings, bytes as hex. */
function plain(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString()
  if (v instanceof Uint8Array) return hex(v)
  if (Array.isArray(v)) return v.map(plain)
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  return v
}

const policy = (p: ClaimPolicy): Policy =>
  p.__kind === "Proven"
    ? { kind: "proven", minAccepted: p.minAccepted }
    : p.__kind === "Allowlist"
      ? { kind: "allowlist" }
      : { kind: "any" }

/**
 * Applies a transaction's events and moves the cursor to it. Returns false if it was already applied.
 * Throws if an event refers to a job the index doesn't have: the indexer must stop, not guess.
 */
export async function applyTransaction(db: Db, tx: IndexedTransaction, o: { cursor?: boolean } = {}): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.select({ id: events.id }).from(events).where(eq(events.sig, tx.sig)).limit(1)
    const fresh = done.length === 0
    if (fresh) for (const e of tx.events) await applyEvent(t, tx, e)
    if (o.cursor)
      await t
        .insert(indexerState)
        .values({ key: CURSOR_KEY, lastSlot: tx.slot, lastSig: tx.sig })
        .onConflictDoUpdate({
          target: indexerState.key,
          set: { lastSlot: tx.slot, lastSig: tx.sig, updatedAt: sql`now()` },
        })
    return fresh
  })
}

async function liveJob(t: Tx, pda: string) {
  const [j] = await t
    .select()
    .from(jobs)
    .where(and(eq(jobs.pda, pda), isNull(jobs.closedAt)))
  if (!j) throw new Error(`index has no live job at ${pda}`)
  return j
}

async function setJob(t: Tx, no: number, slot: bigint, set: Partial<typeof jobs.$inferInsert>) {
  await t
    .update(jobs)
    .set({ ...set, updatedSlot: slot })
    .where(eq(jobs.displayNo, no))
}

async function record(
  t: Tx,
  tx: IndexedTransaction,
  e: DecodedEscrowEvent,
  row: { pda: string; no: number; kind: EventKind; actor: string; at: bigint; amount?: bigint; fee?: bigint },
) {
  await t.insert(events).values({
    jobPda: row.pda,
    jobNo: row.no,
    kind: row.kind,
    actor: row.actor,
    amount: row.amount ?? null,
    fee: row.fee ?? null,
    data: plain(e.data),
    slot: tx.slot,
    sig: tx.sig,
    ix: e.ix,
    at: row.at,
  })
}

async function bumpPoster(
  t: Tx,
  address: string,
  slot: bigint,
  column: "posted" | "paid" | "refundedAfterDelivery" | "rejections" | "cancelled",
) {
  await t
    .insert(posters)
    .values({ address, [column]: 1, updatedSlot: slot })
    .onConflictDoUpdate({ target: posters.address, set: { [column]: sql`${posters[column]} + 1`, updatedSlot: slot } })
}

async function seeMachine(t: Tx, address: string, at: bigint, slot: bigint) {
  await t
    .insert(machines)
    .values({ address, firstSeen: at, updatedSlot: slot })
    .onConflictDoNothing({ target: machines.address })
}

async function closeJob(t: Tx, no: number, slot: bigint, status: JobStatus, at: bigint) {
  await setJob(t, no, slot, { status, closedAt: at })
  // the job's delivered files are deleted DELIVERY_RETENTION_SEC after it closes (the worker's purge loop, §5.2)
  await t
    .update(deliveries)
    .set({ purgeAfter: new Date(Number(at + BigInt(DELIVERY_RETENTION_SEC)) * 1000) })
    .where(eq(deliveries.jobNo, no))
}

async function applyEvent(t: Tx, tx: IndexedTransaction, e: DecodedEscrowEvent) {
  const slot = tx.slot
  switch (e.name) {
    case "JobPosted": {
      const d = e.data
      const specHex = hex(d.specHash)
      const [spec] = await t.select().from(specs).where(eq(specs.specHash, specHex))
      // on the board only if the stored spec re-hashes to the chain's value and passed moderation (§6.1, §12)
      const visible = !!spec && spec.verdict === "pass" && toHex(sha256(spec.canonical)) === specHex
      const [{ next }] = (await t
        .select({ next: sql<number>`coalesce(max(${jobs.displayNo}), 0) + 1` })
        .from(jobs)) as [{ next: number }]
      await t.insert(jobs).values({
        displayNo: Number(next),
        pda: d.job,
        poster: d.poster,
        postedFrom: spec?.postedFrom ?? "api",
        jobId: d.jobId.toString(),
        specHash: specHex,
        reward: d.reward,
        feeBps: d.feeBps,
        status: "open",
        policy: policy(d.policy),
        allowlist: d.allowlist,
        deadline: d.deadline,
        reviewWindow: Number(d.reviewWindow),
        claimWindow: Number(d.claimWindow),
        deliveries: 0,
        createdAt: d.createdAt,
        postedSlot: slot,
        updatedSlot: slot,
        hidden: !visible,
      })
      await bumpPoster(t, d.poster, slot, "posted")
      await record(t, tx, e, {
        pda: d.job,
        no: Number(next),
        kind: "posted",
        actor: d.poster,
        at: d.createdAt,
        amount: d.reward,
      })
      return
    }
    case "JobCancelled": {
      const j = await liveJob(t, e.data.job)
      await closeJob(t, j.displayNo, slot, "cancelled", e.data.at)
      await bumpPoster(t, j.poster, slot, "cancelled")
      await record(t, tx, e, {
        pda: j.pda,
        no: j.displayNo,
        kind: "cancelled",
        actor: j.poster,
        at: e.data.at,
        amount: e.data.refunded,
      })
      return
    }
    case "JobClaimed": {
      const j = await liveJob(t, e.data.job)
      await setJob(t, j.displayNo, slot, { status: "claimed", worker: e.data.machine, claimedAt: e.data.claimedAt })
      await seeMachine(t, e.data.machine, e.data.claimedAt, slot)
      await record(t, tx, e, {
        pda: j.pda,
        no: j.displayNo,
        kind: "claimed",
        actor: e.data.machine,
        at: e.data.claimedAt,
      })
      return
    }
    case "JobUnclaimed":
    case "ClaimExpired": {
      const j = await liveJob(t, e.data.job)
      await setJob(t, j.displayNo, slot, { status: "open", worker: null, claimedAt: null })
      const kind = e.name === "JobUnclaimed" ? "unclaimed" : "claim_expired"
      await record(t, tx, e, { pda: j.pda, no: j.displayNo, kind, actor: e.data.machine, at: e.data.at })
      return
    }
    case "DeliverySubmitted": {
      const d = e.data
      const j = await liveJob(t, d.job)
      const h = hex(d.deliveryHash)
      await setJob(t, j.displayNo, slot, {
        status: "delivered",
        deliveryHash: h,
        deliveredAt: d.deliveredAt,
        deliveries: d.attempt,
      })
      await t
        .update(deliveries)
        .set({ submittedSig: tx.sig })
        .where(and(eq(deliveries.jobNo, j.displayNo), eq(deliveries.deliveryHash, h), isNull(deliveries.submittedSig)))
      await record(t, tx, e, { pda: j.pda, no: j.displayNo, kind: "delivered", actor: d.machine, at: d.deliveredAt })
      return
    }
    case "DeliveryRejected": {
      const d = e.data
      const j = await liveJob(t, d.job)
      // a rejection restarts the claim (DECISIONS, M2); the last allowed one refunds, and JobRefunded follows
      if (!d.refunded) await setJob(t, j.displayNo, slot, { status: "claimed", deadline: d.deadline, claimedAt: d.at })
      await t
        .update(machines)
        .set({ rejected: sql`${machines.rejected} + 1`, updatedSlot: slot })
        .where(eq(machines.address, d.machine))
      await bumpPoster(t, j.poster, slot, "rejections")
      await t
        .update(rejections)
        .set({ sig: tx.sig, at: d.at })
        .where(
          and(
            eq(rejections.jobNo, j.displayNo),
            eq(rejections.attempt, d.attempt),
            eq(rejections.reasonHash, hex(d.reasonHash)),
            isNull(rejections.sig),
          ),
        )
      await record(t, tx, e, { pda: j.pda, no: j.displayNo, kind: "rejected", actor: j.poster, at: d.at })
      return
    }
    case "JobPaid": {
      const d = e.data
      const j = await liveJob(t, d.job)
      await closeJob(t, j.displayNo, slot, "paid", d.at)
      // earned counts reward − fee, as MachineStats does; anything donated to the vault is not earnings
      await t
        .update(machines)
        .set({
          accepted: sql`${machines.accepted} + 1`,
          earned: sql`${machines.earned} + ${(d.reward - d.fee).toString()}::numeric`,
          lastPaidAt: d.at,
          updatedSlot: slot,
        })
        .where(eq(machines.address, d.machine))
      await bumpPoster(t, j.poster, slot, "paid")
      const kind = d.auto ? "auto_released" : "paid"
      await record(t, tx, e, {
        pda: j.pda,
        no: j.displayNo,
        kind,
        actor: d.machine,
        at: d.at,
        amount: d.toMachine,
        fee: d.fee,
      })
      return
    }
    case "JobRefunded": {
      const d = e.data
      const j = await liveJob(t, d.job)
      await closeJob(t, j.displayNo, slot, "refunded", d.at)
      if (d.deliveries > 0) await bumpPoster(t, j.poster, slot, "refundedAfterDelivery")
      await record(t, tx, e, {
        pda: j.pda,
        no: j.displayNo,
        kind: "refunded",
        actor: d.poster,
        at: d.at,
        amount: d.refunded,
      })
      return
    }
    // config and admin changes have no job; the API reads the current Config from the chain
    case "ConfigInitialized":
    case "ConfigUpdated":
    case "AdminProposed":
    case "AdminAccepted":
      return
  }
}
