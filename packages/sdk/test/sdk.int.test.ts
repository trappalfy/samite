// @samite/sdk on the local harness (needs `pnpm --filter @samite/local run up` and `pnpm --filter web build`):
// a poster and a machine, each with only its own key and RPC, through post → claim → deliver a file → accept.
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { isUp, loadSigners, localClient, startServices, usdcAccount } from "@samite/local"
import { createSamite, type Samite } from "../src"

let stop: () => void
let poster: Samite, machine: Samite
let k: Awaited<ReturnType<typeof loadSigners>>
const { rpc } = localClient()
const usdcOf = async (owner: string) =>
  BigInt((await rpc.getTokenAccountBalance(await usdcAccount(owner as never)).send()).value.amount)

beforeAll(async () => {
  if (!(await isUp())) throw new Error("start the local harness first: pnpm --filter @samite/local run up")
  k = await loadSigners()
  const svc = await startServices({ webPort: 3301, workerPort: 8793 })
  stop = svc.stop
  poster = createSamite({ api: svc.api, rpc, signer: k.poster })
  machine = createSamite({ api: svc.api, rpc, signer: k.machine })
}, 120_000)
afterAll(() => stop?.())

async function indexed(ref: string, status: string) {
  for (let i = 0; i < 100; i++) {
    const r = await poster
      .request<{ job: { status: string } }>("GET", `/api/v1/jobs/${ref}`, undefined, false)
      .catch(() => null)
    if (r?.job.status === status) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`${ref} never became ${status}`)
}

const SPEC = {
  v: "samite/job@1",
  title: "Summarise 40 earnings calls",
  instructions: "One paragraph per call, in English. Sources are public transcripts on example.com.",
  accepted_when: ["40 paragraphs, one per call"],
  deliverable: { kind: "file", max_bytes: 1_000_000 },
  category: "research",
}

describe("@samite/sdk on the local validator", () => {
  let pda = ""
  it("posts a job from a machine's wallet; a dry run signs nothing", async () => {
    const dry = await poster.jobs.post({ spec: SPEC, reward: 40_000_000n, deadline: "3d" }, { dryRun: true })
    expect(dry).toMatchObject({
      signature: null,
      summary: { usdc: { lock: "40000000", to_machine: "39000000", fee: "1000000" } },
    })
    const before = await usdcOf(k.poster.address)
    const sent = await poster.jobs.post({ spec: SPEC, reward: 40_000_000n, deadline: "3d" })
    expect(sent.signature).toBeTruthy()
    expect(await usdcOf(k.poster.address)).toBe(before - 40_000_000n)
    pda = sent.summary.job
    await indexed(pda, "open")
  })

  it("finds it on the board and verifies its spec against the chain", async () => {
    const found = await machine.jobs.find({ category: "research" })
    expect(found.jobs.some((j) => j.pda === pda)).toBe(true)
    const job = await machine.jobs.get(pda)
    expect(job.specVerified).toBe(true)
    expect(job.spec).toMatchObject({ title: SPEC.title })
  })

  it("claims, delivers a file, and is paid 97.5% when the poster accepts", async () => {
    await machine.jobs.claim(pda)
    await indexed(pda, "claimed")
    const dir = mkdtempSync(join(tmpdir(), "samite-sdk-"))
    const file = join(dir, "summaries.md")
    writeFileSync(file, "# Call 1\nRevenue grew 12%.\n")
    const delivered = await machine.deliveries.submit(pda, { files: [file], note: "All 40 calls." })
    expect(delivered.signature).toBeTruthy()
    await indexed(pda, "delivered")

    const seen = (await poster.deliveries.get(pda)) as {
      deliveries: { matches_chain: boolean; files: { name: string }[] }[]
    }
    expect(seen.deliveries[0]).toMatchObject({ matches_chain: true, files: [{ name: "summaries.md" }] })

    const before = { machine: await usdcOf(k.machine.address), treasury: await usdcOf(k.treasury.address) }
    const accepted = await poster.reviews.accept(pda)
    expect(accepted.summary.usdc).toEqual({ to_machine: "39000000", fee: "1000000" })
    expect((await usdcOf(k.machine.address)) - before.machine).toBe(39_000_000n)
    expect((await usdcOf(k.treasury.address)) - before.treasury).toBe(1_000_000n)
    await indexed(pda, "paid")
    const mine = await machine.mine()
    expect((mine.working as { pda: string; status: string }[]).find((j) => j.pda === pda)?.status).toBe("paid")
    expect((await machine.balance()).usdc).toBe(before.machine + 39_000_000n)
  })
})
