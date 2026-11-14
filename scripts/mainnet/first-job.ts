// pnpm --filter @samite/mainnet exec tsx first-job.ts --rpc <mainnet RPC> --poster <keypair.json> --machine <keypair.json> [--reward 1] [--go]
import { address, isSome } from "@solana/kit"
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token"
import { formatUsdc, parseUsdc, splitReward } from "@samite/config/money"
import { USDC_MINT } from "@samite/config/solana"
import { deliveryHash, parseDelivery, parseJobSpec, specHash } from "@samite/formats"
import { actions, claimPolicy, fetchConfig, fetchMaybeJob, findConfigPda, JobStatus } from "@samite/program-client"
import { args, confirmGo, fail, header, mainnetRpc, send, signerFrom, sol } from "./lib"

header([
  "THE FIRST MAINNET JOB, END TO END (owner only: CLAUDE.md §14 M5)",
  "",
  "What it sends:  four transactions. 1) post_job from --poster, locking --reward USDC (1 to 5) in the job's escrow;",
  "                2) claim_job from --machine (a second wallet of yours); 3) submit_delivery from --machine;",
  "                4) accept_delivery from --poster, which pays the machine 97.5% and the treasury 2.5%.",
  "From which key: --poster (USDC + a little SOL) and --machine (a little SOL; its USDC account is created if",
  "                missing, paid by the machine).",
  "What it costs:  the reward moves poster → machine (97.5%) and treasury (2.5%): with both wallets yours, the",
  "                net cost is the 2.5% fee plus network fees (4 × 0.000005 SOL) plus the machine's one-time",
  "                record rent (about 0.0013 SOL, stays with the record). The job's rent comes back to --poster.",
  "Not sent:       nothing, unless you pass --go and type GO. The worker indexes the job like any other; its spec",
  "                is not stored through the API, so the board keeps it hidden (its money rules are unchanged).",
])

const a = args()
const rpc = await mainnetRpc(a.get("rpc"))
const poster = await signerFrom(a.need("poster"))
const machine = await signerFrom(a.need("machine"))
if (poster.address === machine.address) fail("--poster and --machine must be different wallets")
const reward = parseUsdc(a.get("reward") ?? "1")
if (reward === null || reward < 1_000_000n || reward > 5_000_000n) fail("--reward is 1 to 5 USDC for the first job")
const mint = address(USDC_MINT)
const ctx = { usdcMint: mint }
const ata = async (owner: string) =>
  (await findAssociatedTokenPda({ owner: address(owner), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]
const usdcOf = async (owner: string) => {
  const r = await rpc
    .getTokenAccountBalance(await ata(owner))
    .send()
    .catch(() => null)
  return r ? BigInt(r.value.amount) : 0n
}

const config = await fetchConfig(rpc, (await findConfigPda())[0])
const { toMachine, fee } = splitReward(reward, config.data.feeBps)
const before = {
  poster: await usdcOf(poster.address),
  machine: await usdcOf(machine.address),
  treasury: BigInt((await rpc.getTokenAccountBalance(config.data.treasury).send()).value.amount),
}
console.log(
  `Poster:   ${poster.address}  ${formatUsdc(before.poster)} USDC, ${sol((await rpc.getBalance(poster.address).send()).value)}`,
)
console.log(
  `Machine:  ${machine.address}  ${formatUsdc(before.machine)} USDC, ${sol((await rpc.getBalance(machine.address).send()).value)}`,
)
console.log(`Treasury: ${config.data.treasury}  ${formatUsdc(before.treasury)} USDC`)
console.log(
  `Reward ${formatUsdc(reward)} USDC → machine ${formatUsdc(toMachine, { decimals: "exact" })}, treasury ${formatUsdc(fee, { decimals: "exact" })} (${config.data.feeBps / 100}%)`,
)
if (before.poster < reward) fail("the poster doesn't hold enough USDC")
if (!a.go) {
  console.log("\nDry run: nothing was sent. Add --go to run the four transactions.")
  process.exit(0)
}
await confirmGo(`run the first job (lock ${formatUsdc(reward)} USDC)`)

const spec = parseJobSpec({
  v: "samite/job@1",
  title: "First Samite job on mainnet",
  instructions: "Reply with the text OK. This job checks the escrow end to end.",
  accepted_when: ["The delivery is the text OK"],
  deliverable: { kind: "text" },
  category: "other",
})
if (!spec.ok) fail("spec")
const posted = await actions.postJob(ctx, {
  poster,
  reward,
  deadline: BigInt(Math.floor(Date.now() / 1000)) + 86_400n,
  reviewWindow: 3_600n,
  claimWindow: 3_600n,
  policy: claimPolicy("Allowlist"),
  allowlist: [machine.address], // only your second wallet can take it
  specHash: specHash(spec.spec).hash,
})
console.log(`1/4 post    ${await send(rpc, poster, [posted.instruction])}`)
const machineAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
  payer: machine,
  owner: machine.address,
  mint,
})
console.log(
  `2/4 claim   ${await send(rpc, machine, [machineAta, await actions.claimJob(ctx, { machine, job: posted.job })])}`,
)
const manifest = parseDelivery({ v: "samite/delivery@1", job: posted.job, attempt: 1, kind: "text", text: "OK" })
if (!manifest.ok) fail("manifest")
console.log(
  `3/4 deliver ${await send(rpc, machine, [await actions.submitDelivery(ctx, { machine, job: posted.job, deliveryHash: deliveryHash(manifest.delivery).hash })])}`,
)
const job = await fetchMaybeJob(rpc, posted.job)
if (!job.exists || job.data.status !== JobStatus.Delivered || !isSome(job.data.worker))
  fail("the job is not delivered on-chain")
console.log(
  `4/4 accept  ${await send(rpc, poster, [await actions.acceptDelivery(ctx, { poster, job: posted.job, machine: machine.address, treasury: config.data.treasury })])}`,
)

const after = {
  machine: await usdcOf(machine.address),
  treasury: BigInt((await rpc.getTokenAccountBalance(config.data.treasury).send()).value.amount),
}
const okMachine = after.machine - before.machine === toMachine
const okTreasury = after.treasury - before.treasury === fee
console.log(
  `\nMachine  +${formatUsdc(after.machine - before.machine, { decimals: "exact" })} USDC ${okMachine ? "✓" : "✗ expected " + formatUsdc(toMachine, { decimals: "exact" })}`,
)
console.log(
  `Treasury +${formatUsdc(after.treasury - before.treasury, { decimals: "exact" })} USDC ${okTreasury ? "✓ exactly 2.5%" : "✗ expected " + formatUsdc(fee, { decimals: "exact" })}`,
)
console.log(
  `Job ${posted.job}: check that the index shows it paid (the worker's database, or GET /api/v1/jobs/${posted.job} on a preview).`,
)
if (!okMachine || !okTreasury)
  fail("the amounts are not what the program promises: stop and investigate before anything else")
