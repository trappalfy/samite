import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDb, type Db } from "../src"
import { migrate } from "../src/migrate"
import { events, jobs, machines, posters, rejections, sessions, specs, deliveries, indexerState } from "../src/schema"

// CLAUDE.md §8 on an in-memory PGlite: every table, money as bigint, the uniqueness the indexer relies on.
let db: Db
beforeAll(async () => {
  db = await createDb(process.env.SAMITE_DB_URL ?? "memory://") // SAMITE_DB_URL: run the same tests on a real Postgres
  await migrate(db)
})
afterAll(async () => db.$client.close?.() ?? db.$client.end?.())

const PDA = "J0b5aXg1F9J0b5aXg1F9J0b5aXg1F9J0b5aXg1F9a1F"
const HASH = "a".repeat(64)

describe("schema", () => {
  it("stores a spec and a job with u64 amounts exactly", async () => {
    await db
      .insert(specs)
      .values({
        specHash: HASH,
        canonical: new Uint8Array([123, 125]),
        title: "Label images",
        category: "data",
        json: { v: "samite/job@1" },
        verdict: "pass",
      })
    await db.insert(jobs).values({
      pda: PDA,
      displayNo: 415,
      poster: "P",
      postedFrom: "app",
      jobId: "18446744073709551615",
      specHash: HASH,
      reward: 18_446_744_073_709_551_615n,
      feeBps: 250,
      status: "open",
      policy: { kind: "any" },
      allowlist: [],
      deadline: 1_800_000_000n,
      reviewWindow: 172_800,
      claimWindow: 0,
      deliveries: 0,
      createdAt: 1_799_000_000n,
      postedSlot: 10n,
      updatedSlot: 10n,
    })
    const [j] = await db.select().from(jobs).where(eq(jobs.pda, PDA))
    expect(j!.reward).toBe(18_446_744_073_709_551_615n)
    expect(j!.jobId).toBe("18446744073709551615")
    expect(j!.hidden).toBe(false)
    const [s] = await db.select().from(specs)
    expect(Array.from(s!.canonical!)).toEqual([123, 125])
  })

  it("refuses a second job with the same display number", async () => {
    await expect(
      db
        .insert(jobs)
        .values({
          pda: "other",
          displayNo: 415,
          poster: "P",
          postedFrom: "api",
          jobId: "1",
          specHash: HASH,
          reward: 1n,
          feeBps: 250,
          status: "open",
          policy: { kind: "any" },
          allowlist: [],
          deadline: 1n,
          reviewWindow: 1,
          claimWindow: 0,
          deliveries: 0,
          createdAt: 1n,
          postedSlot: 1n,
          updatedSlot: 1n,
        }),
    ).rejects.toThrow()
  })

  it("lets a poster re-use a job id after the job closed: one live job per address, history kept", async () => {
    const job = {
      poster: "P",
      postedFrom: "api" as const,
      jobId: "7",
      specHash: HASH,
      reward: 1n,
      feeBps: 250,
      policy: { kind: "any" as const },
      allowlist: [],
      deadline: 1n,
      reviewWindow: 1,
      claimWindow: 0,
      deliveries: 0,
      createdAt: 1n,
      postedSlot: 1n,
      updatedSlot: 1n,
    }
    await db.insert(jobs).values({ ...job, pda: "REUSED", displayNo: 500, status: "cancelled", closedAt: 2n })
    await db.insert(jobs).values({ ...job, pda: "REUSED", displayNo: 501, status: "open" })
    await expect(db.insert(jobs).values({ ...job, pda: "REUSED", displayNo: 502, status: "open" })).rejects.toThrow()
    expect((await db.select().from(jobs).where(eq(jobs.pda, "REUSED"))).length).toBe(2)
  })

  it("keeps one row per event: (signature, index) is unique, two events of one transaction are fine", async () => {
    const base = { jobPda: PDA, jobNo: 415, actor: "M", slot: 12n, at: 1_799_000_100n }
    await db.insert(events).values({ ...base, sig: "S1", ix: 0, kind: "rejected" })
    await db.insert(events).values({ ...base, sig: "S1", ix: 1, kind: "refunded", amount: 5n })
    await expect(db.insert(events).values({ ...base, sig: "S1", ix: 1, kind: "refunded" })).rejects.toThrow()
  })

  it("has every other §8 table", async () => {
    await db
      .insert(deliveries)
      .values({
        jobPda: PDA,
        jobNo: 415,
        attempt: 1,
        worker: "M",
        manifest: {},
        deliveryHash: HASH,
        storageKeys: ["k"],
        purgeAfter: new Date(0),
      })
    await db
      .insert(rejections)
      .values({
        jobPda: PDA,
        jobNo: 415,
        attempt: 1,
        reason: "Rows 12 to 40 have no price.",
        reasonHash: HASH,
        sig: "S1",
        at: 1n,
      })
    await db.insert(machines).values({ address: "M", accepted: 1, rejected: 0, earned: 117_000_000n, firstSeen: 1n })
    await db.insert(posters).values({ address: "P", posted: 1 })
    await db.insert(sessions).values({ id: "sess", address: "P", expiresAt: new Date(Date.now() + 1e6) })
    await db.insert(indexerState).values({ key: "escrow", lastSlot: 12n, lastSig: "S1" })
    expect((await db.select().from(machines))[0]!.earned).toBe(117_000_000n)
    expect((await db.select().from(posters))[0]!.paid).toBe(0)
  })
})

describe("migrations", () => {
  it("can run again on a migrated database and on a directory-backed PGlite", async () => {
    await migrate(db)
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "samite-db-"))
    try {
      const fileDb = await createDb(`pglite://${dir}`)
      await migrate(fileDb)
      await fileDb.insert(posters).values({ address: "P" })
      expect((await fileDb.select().from(posters)).length).toBe(1)
      await fileDb.$client.close?.()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
