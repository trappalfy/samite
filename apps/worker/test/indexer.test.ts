import { afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@samite/db"
import { decodeEscrowEvents } from "@samite/program-client"
import { applyTransaction } from "../src/indexer/apply"
import { syncOnce } from "../src/indexer/sync"
import { fakeRpc, fixture, freshDb, JOBS, NO, PROGRAM, snapshot } from "./session"

// CLAUDE.md §7.2, §13 "Indexer": replay a recorded local session; kill and restart mid-way; the index ends identical.
const open: Db[] = []
const db = async () => {
  const d = await freshDb()
  open.push(d)
  return d
}
afterEach(async () => {
  for (const d of open.splice(0)) await d.$client.close?.()
})

const N = fixture.notes
let clean: Awaited<ReturnType<typeof snapshot>>
beforeAll(async () => {
  const d = await freshDb()
  await syncOnce(d, fakeRpc(), { program: PROGRAM })
  clean = await snapshot(d)
  await d.$client.close?.()
})

describe("a recorded session, indexed once", () => {
  it("numbers jobs in JobPosted order and ends each in the chain's state", () => {
    const by = Object.fromEntries(clean.jobs.map((j) => [j.displayNo, j]))
    expect(clean.jobs.map((j) => j.displayNo)).toEqual([1, 2, 3, 4, 5])
    expect(by[NO.A]).toMatchObject({
      pda: JOBS.A,
      status: "paid",
      worker: N.machine,
      deliveries: 1,
      reward: 80_000_000n,
      hidden: false,
      postedFrom: "app",
    })
    expect(by[NO.B]).toMatchObject({ pda: JOBS.B, status: "cancelled", hidden: false })
    expect(by[NO.C]).toMatchObject({
      pda: JOBS.C,
      status: "refunded",
      worker: N.machine2,
      deliveries: 3,
      claimWindow: 3600,
    })
    expect(by[NO.A]!.closedAt).not.toBeNull()
    expect(by[NO.E]!.closedAt).toBeNull()
  })

  it("keeps a job posted around the API, and one with a refused spec, off the board", () => {
    const by = Object.fromEntries(clean.jobs.map((j) => [j.displayNo, j]))
    expect(by[NO.D]).toMatchObject({ status: "claimed", hidden: true, postedFrom: "api" })
    expect(by[NO.E]).toMatchObject({ status: "open", hidden: true })
  })

  it("gives a re-used job address a new job with its own history", () => {
    const e = clean.jobs.find((j) => j.displayNo === NO.E)!
    expect(e.pda).toBe(JOBS.B)
    expect(clean.events.filter((x) => x.jobNo === NO.B).map((x) => x.kind)).toEqual(["posted", "cancelled"])
    expect(clean.events.filter((x) => x.jobNo === NO.E).map((x) => x.kind)).toEqual(["posted"])
  })

  it("records every event once, both events of the refunding rejection included", () => {
    expect(clean.events.filter((x) => x.jobNo === NO.C).map((x) => x.kind)).toEqual([
      "posted",
      "claimed",
      "unclaimed",
      "claimed",
      "delivered",
      "rejected",
      "delivered",
      "rejected",
      "delivered",
      "rejected",
      "refunded",
    ])
    const paid = clean.events.find((x) => x.kind === "paid")!
    expect(paid).toMatchObject({ jobNo: NO.A, actor: N.machine, amount: 78_000_000n, fee: 2_000_000n })
    const refund = clean.events.find((x) => x.kind === "refunded")!
    expect(refund).toMatchObject({ jobNo: NO.C, actor: N.poster, amount: 120_000_000n })
  })

  it("shows the race's winner, not the claim that failed on-chain", () => {
    const winner = fixture.signatures.find((s) => N.race!.includes(s.signature) && !s.err)!
    const tx = fixture.transactions[winner.signature] as Parameters<typeof decodeEscrowEvents>[0]
    const ev = decodeEscrowEvents(tx, PROGRAM)[0]!
    expect(ev.name).toBe("JobClaimed")
    const d = clean.jobs.find((j) => j.displayNo === NO.D)!
    expect(d.worker).toBe((ev.data as { machine: string }).machine)
    expect(clean.events.filter((x) => x.jobNo === NO.D && x.kind === "claimed")).toHaveLength(1)
  })

  it("counts machines and posters as the chain does (§4.2, §4.6)", () => {
    const m = Object.fromEntries(clean.machines.map((x) => [x.address, x]))
    expect(m[N.machine!]).toMatchObject({ accepted: 1, rejected: 0, earned: 78_000_000n })
    expect(m[N.machine2!]).toMatchObject({ accepted: 0, rejected: 3, earned: 0n })
    expect(clean.posters).toHaveLength(1)
    expect(clean.posters[0]).toMatchObject({
      address: N.poster,
      posted: 5,
      paid: 1,
      cancelled: 1,
      refundedAfterDelivery: 1,
      rejections: 3,
    })
  })

  it("links the stored manifests and reasons to their on-chain transactions", () => {
    expect(clean.deliveries).toHaveLength(4)
    expect(clean.deliveries.every((d) => typeof d.submittedSig === "string")).toBe(true)
    expect(clean.rejections).toHaveLength(3)
    expect(clean.rejections.every((r) => typeof r.sig === "string" && typeof r.at === "bigint")).toBe(true)
  })

  it("dates each closed job's delivered files for deletion 90 days after it closed, and no open job's", () => {
    const closedAt = new Map(clean.jobs.map((j) => [j.displayNo, j.closedAt]))
    for (const d of clean.deliveries as { jobNo: number; purgeAfter: Date | null }[]) {
      const at = closedAt.get(d.jobNo)
      if (at == null) expect(d.purgeAfter).toBeNull()
      else expect(d.purgeAfter?.getTime()).toBe((Number(at) + 90 * 24 * 3600) * 1000)
    }
    expect(clean.deliveries.some((d) => d.purgeAfter !== null)).toBe(true)
  })

  it("remembers where it stopped", () => {
    expect(clean.state).toEqual([
      { key: "escrow", lastSig: fixture.signatures[0]!.signature, lastSlot: fixture.signatures[0]!.slot },
    ])
  })
})

describe("replays, restarts and gaps end in the same index", () => {
  it("is a no-op the second time", async () => {
    const d = await db()
    await syncOnce(d, fakeRpc(), { program: PROGRAM })
    await syncOnce(d, fakeRpc(), { program: PROGRAM })
    expect(await snapshot(d)).toEqual(clean)
  })

  it("applies each transaction at most once, even when replayed by hand", async () => {
    const d = await db()
    await syncOnce(d, fakeRpc(), { program: PROGRAM })
    for (const s of [...fixture.signatures].reverse()) {
      const tx = fixture.transactions[s.signature] as Parameters<typeof decodeEscrowEvents>[0]
      await applyTransaction(d, { sig: s.signature, slot: s.slot, events: decodeEscrowEvents(tx, PROGRAM) })
    }
    expect(await snapshot(d)).toEqual(clean)
  })

  it("survives a kill at every point and catches up on restart", async () => {
    const calls = fixture.signatures.filter((s) => !s.err).length
    for (let k = 1; k <= calls; k++) {
      const d = await db()
      await expect(syncOnce(d, fakeRpc({ failAt: k }), { program: PROGRAM })).rejects.toThrow("killed")
      await syncOnce(d, fakeRpc(), { program: PROGRAM })
      expect(await snapshot(d), `killed at call ${k}`).toEqual(clean)
      await d.$client.close?.()
      open.pop()
    }
  }, 120_000)

  it("backfills from the start when the cursor is lost, without double counting", async () => {
    const d = await db()
    await syncOnce(d, fakeRpc(), { program: PROGRAM })
    const { schema } = await import("@samite/db")
    await d.delete(schema.indexerState)
    await syncOnce(d, fakeRpc(), { program: PROGRAM })
    expect(await snapshot(d)).toEqual(clean)
  })

  it("falls back to the cursor's slot when the RPC no longer knows the cursor's transaction", async () => {
    const d = await db()
    const all = fixture.signatures
    await syncOnce(d, fakeRpc({ signatures: all.slice(all.length - 12) }), { program: PROGRAM })
    await syncOnce(d, fakeRpc({ forgetUntil: true, pageSize: undefined } as never), { program: PROGRAM, pageSize: 4 })
    expect(await snapshot(d)).toEqual(clean)
  })

  it("reads signatures in small pages", async () => {
    const d = await db()
    await syncOnce(d, fakeRpc(), { program: PROGRAM, pageSize: 3 })
    expect(await snapshot(d)).toEqual(clean)
  })

  it("stops at a transaction the RPC can't return yet, and continues from there next time", async () => {
    const d = await db()
    const middle = [...fixture.signatures].reverse()[10]!.signature
    await syncOnce(d, fakeRpc({ missing: middle }), { program: PROGRAM })
    const { state } = await snapshot(d)
    expect(state[0]!.lastSig).not.toBe(fixture.signatures[0]!.signature)
    await syncOnce(d, fakeRpc(), { program: PROGRAM })
    expect(await snapshot(d)).toEqual(clean)
  })

  it("indexes the chain as it grows: the same tables after syncing at every step", async () => {
    const d = await db()
    const all = fixture.signatures
    for (let n = 1; n <= all.length; n++)
      await syncOnce(d, fakeRpc({ signatures: all.slice(all.length - n) }), { program: PROGRAM })
    expect(await snapshot(d)).toEqual(clean)
  }, 30_000)
})
