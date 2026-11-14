// The recorded local session (scripts/record-session.ts) served by a fake RPC, and a snapshot of every index table.
import { readFileSync } from "node:fs"
import { asc } from "drizzle-orm"
import type { Address } from "@solana/kit"
import { createDb, schema, type Db } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import { parse, type SessionFixture } from "../scripts/fixture"
import type { IndexerRpc } from "../src/indexer/sync"

export const fixture = parse<SessionFixture>(readFileSync(new URL("./fixtures/session.json", import.meta.url), "utf8"))
export const PROGRAM = fixture.program as Address
const job = (k: string) => fixture.notes[k]!.split(" ")[0]!
export const JOBS = { A: job("A"), B: job("B"), C: job("C"), D: job("D"), E: job("E") }
/** Display numbers follow JobPosted slot order: A, B, C, D, E. */
export const NO = { A: 1, B: 2, C: 3, D: 4, E: 5 }

/** A fake RPC over the recording. `failAt` throws on that getTransaction call (1-based), like a crash mid-sync. */
export function fakeRpc(
  o: { failAt?: number; missing?: string; signatures?: SessionFixture["signatures"]; forgetUntil?: boolean } = {},
) {
  const sigs = o.signatures ?? fixture.signatures // newest first
  let calls = 0
  const rpc = {
    getSignaturesForAddress: (_a: Address, c: { until?: string; before?: string; limit?: number } = {}) => ({
      send: async () => {
        // a node whose ledger no longer has the cursor's transaction (a purged ledger, a pruned provider)
        if (c.until && o.forgetUntil) throw new Error(`Transaction ${c.until} not found`)
        let list = sigs
        if (c.before) list = list.slice(list.findIndex((s) => s.signature === c.before) + 1)
        if (c.until) {
          const i = list.findIndex((s) => s.signature === c.until)
          if (i >= 0) list = list.slice(0, i)
        }
        return list.slice(0, c.limit ?? 1000)
      },
    }),
    getTransaction: (sig: string) => ({
      send: async () => {
        calls++
        if (o.failAt === calls) throw new Error("killed")
        if (o.missing === sig) return null
        return fixture.transactions[sig] ?? null
      },
    }),
  }
  return rpc as unknown as IndexerRpc
}

/** What the API stores before the chain sees anything: specs (POST /specs), manifests and reasons. */
export async function freshDb(): Promise<Db> {
  const db = await createDb("memory://")
  await migrate(db)
  for (const s of fixture.specs)
    await db.insert(schema.specs).values({
      specHash: s.hex,
      canonical: new Uint8Array(Buffer.from(s.canonicalBase64, "base64")),
      title: s.title,
      category: s.category,
      json: JSON.parse(Buffer.from(s.canonicalBase64, "base64").toString("utf8")),
      verdict: s.verdict,
      postedFrom: s.postedFrom,
    })
  const no = (pda: string) => (pda === JOBS.A ? NO.A : NO.C)
  for (const d of fixture.deliveries)
    await db.insert(schema.deliveries).values({
      jobPda: d.job,
      jobNo: no(d.job),
      attempt: d.attempt,
      worker: d.worker,
      manifest: {},
      deliveryHash: d.hex,
    })
  for (const r of fixture.rejections)
    await db
      .insert(schema.rejections)
      .values({ jobPda: r.job, jobNo: no(r.job), attempt: r.attempt, reason: r.reason, reasonHash: r.hex })
  return db
}

/** Every index table, ordered, without server-clock columns (ids and timestamps the database fills in). */
export async function snapshot(db: Db) {
  const drop = <T extends Record<string, unknown>>(rows: T[], keys: string[]) =>
    rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))))
  const t = schema
  return {
    jobs: await db.select().from(t.jobs).orderBy(asc(t.jobs.displayNo)),
    events: drop(await db.select().from(t.events).orderBy(asc(t.events.slot), asc(t.events.sig), asc(t.events.ix)), [
      "id",
    ]),
    machines: await db.select().from(t.machines).orderBy(asc(t.machines.address)),
    posters: await db.select().from(t.posters).orderBy(asc(t.posters.address)),
    deliveries: drop(await db.select().from(t.deliveries).orderBy(asc(t.deliveries.jobNo), asc(t.deliveries.attempt)), [
      "id",
      "createdAt",
    ]),
    rejections: drop(await db.select().from(t.rejections).orderBy(asc(t.rejections.jobNo), asc(t.rejections.attempt)), [
      "id",
      "createdAt",
    ]),
    state: drop(await db.select().from(t.indexerState), ["updatedAt"]),
  }
}
