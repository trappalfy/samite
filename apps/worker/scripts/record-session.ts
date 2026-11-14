// Records a session on the local validator for the indexer tests: `pnpm --filter @samite/local up`, then
// `pnpm --filter @samite/worker record`. Local only (CLAUDE.md §0); it refuses any other RPC.
//
// Jobs: A accept; B cancel; C unclaim → another machine → three rejections (the third refunds, in one transaction);
// D two machines claim at once (one fails on-chain); E re-uses B's job id (same address) with a refused spec.
// D has no stored spec (posted around the API), so the index keeps it hidden.
import { writeFileSync } from "node:fs"
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type Signature,
  type TransactionSigner,
} from "@solana/kit"
import { USDC_MINT } from "@samite/config/solana"
import { parseJobSpec, reasonHash, sha256, specHash, toHex } from "@samite/formats"
import { bootstrap, localClient, LOCAL_RPC } from "@samite/local"
import { actions, claimPolicy, fetchConfig, findConfigPda, SAMITE_ESCROW_PROGRAM_ADDRESS } from "@samite/program-client"
import { stringify, type SessionFixture } from "./fixture"

const OUT = new URL("../test/fixtures/session.json", import.meta.url).pathname
const ctx = { usdcMint: address(USDC_MINT) }
const client = localClient()
if (!LOCAL_RPC.startsWith("http://127.0.0.1")) throw new Error("local validator only")

const s = await bootstrap(client)
const config = await fetchConfig(client.rpc, (await findConfigPda())[0])
const now = BigInt(Math.floor(Date.now() / 1000))
const DAY = 86_400n

const fixture: SessionFixture = {
  program: SAMITE_ESCROW_PROGRAM_ADDRESS,
  signatures: [],
  transactions: {},
  specs: [],
  deliveries: [],
  rejections: [],
  notes: {},
}

function spec(title: string, verdict: "pass" | "refuse", postedFrom: "app" | "api") {
  const r = parseJobSpec({
    v: "samite/job@1",
    title,
    instructions: `${title}. Recorded by apps/worker/scripts/record-session.ts on a local validator.`,
    accepted_when: ["The file opens and has the rows asked for"],
    deliverable: { kind: "file", max_bytes: 1_000_000 },
    category: "data",
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  const h = specHash(r.spec)
  fixture.specs.push({
    hex: h.hex,
    canonicalBase64: Buffer.from(h.canonical).toString("base64"),
    title,
    category: "data",
    verdict,
    postedFrom,
  })
  return h.hash
}

const send = (payer: TransactionSigner, ix: Instruction | Instruction[]) =>
  client.send(payer, Array.isArray(ix) ? ix : [ix])

async function post(
  title: string,
  reward: bigint,
  o: { verdict?: "pass" | "refuse"; stored?: boolean; jobId?: bigint; claimWindow?: bigint } = {},
) {
  const hash = o.stored === false ? sha256(new TextEncoder().encode(title)) : spec(title, o.verdict ?? "pass", "app")
  const p = await actions.postJob(ctx, {
    poster: s.poster,
    jobId: o.jobId,
    reward,
    deadline: now + 3n * DAY,
    reviewWindow: 2n * DAY,
    claimWindow: o.claimWindow ?? 2n * DAY, // no 0 since Nov 13
    policy: claimPolicy("Any"),
    specHash: hash,
  })
  await send(s.poster, p.instruction)
  return p
}

async function deliver(machine: TransactionSigner, job: string, attempt: number) {
  const hash = sha256(new TextEncoder().encode(`${job} delivery ${attempt}`))
  fixture.deliveries.push({ job, attempt, worker: machine.address, hex: toHex(hash) })
  await send(machine, await actions.submitDelivery(ctx, { machine, job: address(job), deliveryHash: hash }))
}

async function reject(job: string, machine: string, attempt: number, reason: string) {
  const h = reasonHash(reason)
  fixture.rejections.push({ job, attempt, reason, hex: h.hex })
  await send(
    s.poster,
    await actions.rejectDelivery(ctx, {
      poster: s.poster,
      job: address(job),
      machine: address(machine),
      reasonHash: h.hash,
    }),
  )
}

// A: post → claim → deliver → accept (80.00 → 78.00 to the machine, 2.00 fee)
const A = await post("Label 5,000 product images by category", 80_000_000n)
await send(s.machine, await actions.claimJob(ctx, { machine: s.machine, job: A.job }))
await deliver(s.machine, A.job, 1)
await send(
  s.poster,
  await actions.acceptDelivery(ctx, {
    poster: s.poster,
    job: A.job,
    machine: s.machine.address,
    treasury: config.data.treasury,
  }),
)

// B: post → cancel
const B = await post("Scrape 2,000 real-estate listings", 5_000_000n)
await send(s.poster, await actions.cancelJob(ctx, { poster: s.poster, job: B.job }))

// C: claim → unclaim → machine2 claims → three deliveries, three rejections (the last refunds the poster)
const C = await post("Transcribe 9 hours of interviews", 120_000_000n, { claimWindow: 3_600n })
await send(s.machine, await actions.claimJob(ctx, { machine: s.machine, job: C.job }))
await send(s.machine, await actions.unclaimJob(ctx, { machine: s.machine, job: C.job }))
await send(s.machine2, await actions.claimJob(ctx, { machine: s.machine2, job: C.job }))
for (let attempt = 1; attempt <= 3; attempt++) {
  await deliver(s.machine2, C.job, attempt)
  await reject(C.job, s.machine2.address, attempt, `Attempt ${attempt}: rows 12 to 40 have no price.`)
}

// D: no stored spec; two machines claim in the same moment, one wins
const D = await post("Posted around the API", 1_000_000n, { stored: false })
const { value: blockhash } = await client.rpc.getLatestBlockhash().send()
const race = await Promise.all(
  [s.machine, s.machine2].map(async (m) => {
    const claim = await actions.claimJob(ctx, { machine: m, job: D.job })
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (x) => setTransactionMessageFeePayerSigner(m, x),
      (x) => setTransactionMessageLifetimeUsingBlockhash(blockhash, x),
      (x) => appendTransactionMessageInstructions([claim], x),
    )
    const signed = await signTransactionMessageWithSigners(msg)
    return client.rpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", skipPreflight: true })
      .send()
  }),
)
for (let i = 0; i < 60; i++) {
  const { value } = await client.rpc.getSignatureStatuses(race).send()
  if (value.every((v) => v?.confirmationStatus === "confirmed" || v?.confirmationStatus === "finalized")) break
  await new Promise((r) => setTimeout(r, 500))
}

// E: B's job id again (B is closed, so the address is free): same PDA, a new job, a refused spec
const E = await post("Find 50 leads, any method needed", 2_000_000n, { jobId: B.jobId, verdict: "refuse" })
if (E.job !== B.job) throw new Error("expected the same job address")

// the record: every signature for the program, and each transaction as the indexer will read it
let before: Signature | undefined
for (;;) {
  const page = await client.rpc
    .getSignaturesForAddress(SAMITE_ESCROW_PROGRAM_ADDRESS, { before, limit: 1000, commitment: "confirmed" })
    .send()
  fixture.signatures.push(
    ...page.map((p) => ({ signature: p.signature, slot: p.slot, err: p.err, blockTime: p.blockTime })),
  )
  if (page.length < 1000) break
  before = page.at(-1)!.signature
}
for (const { signature } of fixture.signatures)
  fixture.transactions[signature] = await client.rpc
    .getTransaction(signature as Signature, {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send()

Object.assign(fixture.notes, {
  poster: s.poster.address,
  machine: s.machine.address,
  machine2: s.machine2.address,
  treasury: config.data.treasury,
  A: `${A.job} accepted`,
  B: `${B.job} cancelled`,
  C: `${C.job} refunded after three rejections`,
  D: `${D.job} claimed in a race; no stored spec`,
  E: `${E.job} B's address again; refused spec`,
  race: race.join(" "),
})
writeFileSync(OUT, stringify(fixture))
console.log(`recorded ${fixture.signatures.length} signatures → ${OUT}`)
