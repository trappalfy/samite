import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getCloseAccountInstruction } from "@solana-program/token"
import { schema } from "@samite/db"
import { actions } from "@samite/program-client"
import { keeperTick } from "../src/keeper/keeper"
import { ctx, harness, hasProgram, type Harness } from "./svm"

// CLAUDE.md §7.2 and §13: the keeper on a chain whose clock we set (LiteSVM). At each boundary second the program
// refuses and the keeper sends nothing; one second later the keeper sends, the program pays, and the index follows.
if (!hasProgram) throw new Error("build the program first: anchor build (target/deploy/samite_escrow.so)")

let h: Harness
beforeEach(async () => {
  h = await harness()
})
afterEach(async () => h.close())

const tick = () => keeperTick({ db: h.db, chain: h.chain, ctx })
const indexed = async (pda: string) =>
  (await h.db.select().from(schema.jobs).where(eq(schema.jobs.pda, pda))).sort((a, b) => b.displayNo - a.displayNo)[0]!
const kinds = async (no: number) =>
  (await h.db.select().from(schema.events).where(eq(schema.events.jobNo, no))).map((e) => e.kind)

describe("the client's constants", () => {
  it("knows the Job account's size, so the post summary reads the right rent", async () => {
    const { JOB_ACCOUNT_BYTES } = await import("@samite/program-client")
    const job = await h.post()
    expect(h.svm.getAccount(job)).toMatchObject({ exists: true, space: BigInt(JOB_ACCOUNT_BYTES) })
  })
})

describe("release after review", () => {
  it("pays the machine 97.5% and the treasury 2.5% one second after the review window", async () => {
    const job = await h.post({ reward: 80_000_000n, reviewWindow: 3_600n })
    await h.claim(job)
    await h.deliver(job)
    const deliveredAt = h.job(job)!.deliveredAt

    h.setTime(deliveredAt + 3_600n)
    expect(await tick()).toEqual([])
    const early = await actions.releaseAfterReview(ctx, {
      job,
      poster: h.poster.address,
      machine: h.machine.address,
      treasury: h.treasury,
    })
    await expect(h.send(h.keeper, [early]), "the program agrees: not yet").rejects.toThrow()

    h.setTime(deliveredAt + 3_601n)
    const [out] = await tick()
    expect(out).toMatchObject({ action: "release", result: "sent" })
    expect(h.job(job)).toBeNull()
    expect(await h.usdc(h.machine.address)).toBe(78_000_000n)
    expect(await h.usdc(h.treasuryOwner.address)).toBe(2_000_000n)

    const row = await indexed(job)
    expect(row).toMatchObject({ status: "paid" })
    expect(await kinds(row.displayNo)).toEqual(["posted", "claimed", "delivered", "auto_released"])
    const [m] = await h.db.select().from(schema.machines).where(eq(schema.machines.address, h.machine.address))
    expect(m).toMatchObject({ accepted: 1, earned: 78_000_000n })
    expect(await tick(), "nothing left to do").toEqual([])
  })
})

describe("refund after deadline", () => {
  it("returns the full reward to the poster one second after the deadline", async () => {
    const before = (await h.usdc(h.poster.address))!
    const job = await h.post({ reward: 5_000_000n, deadlineIn: 7_200n })
    const deadline = h.job(job)!.deadline
    h.setTime(deadline)
    expect(await tick()).toEqual([])
    h.setTime(deadline + 1n)
    expect(await tick()).toMatchObject([{ action: "refund", result: "sent" }])
    expect(await h.usdc(h.poster.address)).toBe(before)
    expect(await indexed(job)).toMatchObject({ status: "refunded" })
  })

  it("never refunds a delivered job: past the deadline it waits for the review window, then pays the machine", async () => {
    const job = await h.post({ deadlineIn: 7_200n, reviewWindow: 86_400n })
    await h.claim(job)
    await h.deliver(job)
    h.setTime(h.job(job)!.deadline + 1n)
    expect(await tick()).toEqual([])
    h.setTime(h.job(job)!.deliveredAt + 86_401n)
    expect(await tick()).toMatchObject([{ action: "release", result: "sent" }])
  })
})

describe("expire claim", () => {
  it("reopens a job one second after its claim window", async () => {
    const job = await h.post({ claimWindow: 3_600n })
    await h.claim(job)
    const claimedAt = h.job(job)!.claimedAt
    h.setTime(claimedAt + 3_600n)
    expect(await tick()).toEqual([])
    h.setTime(claimedAt + 3_601n)
    expect(await tick()).toMatchObject([{ action: "expire", result: "sent" }])
    expect(h.job(job)).toMatchObject({ claimedAt: 0n })
    const row = await indexed(job)
    expect(row).toMatchObject({ status: "open", worker: null })
    expect(await kinds(row.displayNo)).toEqual(["posted", "claimed", "claim_expired"])
  })

  it("leaves a job whose claim window is its whole term alone until the deadline", async () => {
    // no claim window of 0 since Nov 13: "until the deadline" is a window as long as the term
    const job = await h.post({ claimWindow: 100_000n, deadlineIn: 100_000n })
    await h.claim(job)
    h.setTime(h.job(job)!.claimedAt + 99_000n)
    expect(await tick()).toEqual([])
  })
})

describe("what the keeper won't do", () => {
  it("doesn't pay to re-create a closed USDC account; it sends once the owner re-creates it", async () => {
    const job = await h.post({ reviewWindow: 3_600n })
    await h.claim(job)
    await h.deliver(job)
    await h.send(h.machine, [
      getCloseAccountInstruction({
        account: await h.ata(h.machine.address),
        destination: h.machine.address,
        owner: h.machine,
      }),
    ])
    h.setTime(h.job(job)!.deliveredAt + 3_601n)
    expect(await tick()).toMatchObject([
      { action: "release", result: "skipped", detail: "the machine's USDC account is closed" },
    ])
    expect(h.job(job), "the money stays in escrow").not.toBeNull()

    const { getCreateAssociatedTokenIdempotentInstructionAsync } = await import("@solana-program/token")
    await h.send(h.machine, [
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: h.machine,
        owner: h.machine.address,
        mint: ctx.usdcMint,
      }),
    ])
    expect(await tick()).toMatchObject([{ action: "release", result: "sent" }])
    expect(await h.usdc(h.machine.address)).toBe(78_000_000n)
  })

  it("sends nothing the index says is due but the chain says isn't (the index is behind)", async () => {
    const job = await h.post({ deadlineIn: 7_200n })
    // the index thinks the deadline is long gone
    await h.db.update(schema.jobs).set({ deadline: 1n }).where(eq(schema.jobs.pda, job))
    expect(await tick()).toEqual([])
    expect(h.job(job)).not.toBeNull()
  })
})
