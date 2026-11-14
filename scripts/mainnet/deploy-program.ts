// pnpm --filter @samite/mainnet exec tsx deploy-program.ts --rpc <mainnet RPC> --authority <keypair.json> --program-keypair <keypair.json> [--cu-price <micro-lamports>] [--go]
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { args, confirmGo, fail, header, mainnetRpc, network, signerFrom, sol } from "./lib"

header([
  "DEPLOY THE SAMITE ESCROW PROGRAM TO MAINNET (owner only: CLAUDE.md §0, §14 M5)",
  "",
  "What it sends:  `solana program deploy` writes target/deploy/samite_escrow.so into a buffer account over many",
  "                transactions, then deploys it, upgradeable, at the address of --program-keypair.",
  "From which key: --authority pays for everything and becomes the program's UPGRADE AUTHORITY. Keep it offline",
  "                (a hardware wallet), or use a Squads multisig (recommended; then deploy with Squads' flow).",
  "What it costs:  rent for the program data account, sized to the program exactly (an upgrade to a bigger",
  "                program extends it then, paying only the difference: the Solana CLI does it automatically),",
  "                plus a network fee per write transaction, and a priority fee if you pass --cu-price.",
  "                While it runs, a buffer holds a second copy; its rent comes back when the deploy finishes.",
  "                The program data rent stays locked while the program exists (closing the program returns it).",
  "                All of it is computed below from mainnet's live rent.",
  "Not sent:       nothing, unless you pass --go and type GO.",
])

const a = args()
const rpc = await mainnetRpc(a.get("rpc"))
const authority = await signerFrom(a.need("authority"))
const programKey = await signerFrom(a.need("program-keypair"))
const root = fileURLToPath(new URL("../../", import.meta.url))
const so = `${root}target/deploy/samite_escrow.so`

// the program must already say, in its source, that it lives at this address (declare_id!), or every PDA is wrong
const lib = readFileSync(`${root}programs/samite_escrow/src/lib.rs`, "utf8")
const declared = lib.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]{32,44})"\)/)?.[1]
if (declared !== programKey.address)
  fail(
    `declare_id! is ${declared}, but --program-keypair is ${programKey.address}. Set the program id in lib.rs, Anchor.toml and the client, run \`anchor build\`, then run this again.`,
  )
if ((await rpc.getAccountInfo(programKey.address, { encoding: "base64" }).send()).value)
  fail(
    `${programKey.address} already exists on ${network()}. Upgrading is a different step (solana program deploy with the same --program-id, by the upgrade authority).`,
  )

// upgrades rely on the CLI extending the program data account by itself (it has since Agave 2.x)
const help = spawnSync("solana", ["program", "deploy", "--help"], { encoding: "utf8" })
if (help.status !== 0) fail("the `solana` CLI is not installed or not on PATH")
if (!help.stdout.includes("--no-auto-extend"))
  fail("this `solana` CLI is too old to extend a program on upgrade; install a current Agave release first")

const bytes = statSync(so).size
const programDataRent = await rpc.getMinimumBalanceForRentExemption(BigInt(bytes + 45)).send() // 45: ProgramData header
const bufferRent = await rpc.getMinimumBalanceForRentExemption(BigInt(bytes + 37)).send() // 37: Buffer header
const writes = BigInt(Math.ceil(bytes / 1000)) // about 1 KB of program per write transaction
const fees = (writes + 4n) * 5_000n
const cuPrice = a.get("cu-price")
if (cuPrice !== undefined && !/^\d+$/.test(cuPrice))
  fail("--cu-price is a whole number of micro-lamports per compute unit")
const balance = (await rpc.getBalance(authority.address).send()).value
const sha = createHash("sha256").update(readFileSync(so)).digest("hex")

console.log(`Program:            ${programKey.address}`)
console.log(`Program file:       target/deploy/samite_escrow.so, ${bytes} bytes, sha256 ${sha}`)
console.log(`Upgrade authority:  ${authority.address} (pays)`)
console.log(`Program data rent:  ${sol(programDataRent)} (${bytes + 45} bytes; stays locked while the program exists)`)
console.log(`Buffer rent:        ${sol(bufferRent)} while the deploy runs, then returned`)
console.log(
  `Network fees:       about ${sol(fees)} (${writes} write transactions + deploy)${cuPrice ? `, plus a priority fee of ${cuPrice} micro-lamports per compute unit` : ""}`,
)
console.log(
  `Needed at the peak: ${sol(programDataRent + bufferRent + fees)}; ${sol(programDataRent + fees)} spent or locked after`,
)
console.log(`Authority balance:  ${sol(balance)}`)
if (balance < programDataRent + bufferRent + fees) fail("the authority doesn't hold enough SOL for this deploy")

const cmd = [
  "program",
  "deploy",
  so,
  "--program-id",
  a.need("program-keypair"),
  "--upgrade-authority",
  a.need("authority"),
  "--keypair",
  a.need("authority"),
  "--url",
  a.get("rpc")!,
  ...(cuPrice ? ["--with-compute-unit-price", cuPrice] : []),
]
console.log(`\nCommand: solana ${cmd.join(" ")}\n`)
if (!a.go) {
  console.log("Dry run: nothing was sent. Add --go to deploy.")
  process.exit(0)
}
await confirmGo(`deploy ${programKey.address}`)
const r = spawnSync("solana", cmd, { stdio: "inherit" })
if (r.status !== 0)
  fail(
    "solana program deploy failed; read its output above. A half-written buffer can be closed with `solana program close --buffers`.",
  )
console.log(`\n✓ Deployed ${programKey.address}. Next: initialize-config.ts. Keep the upgrade authority's key offline.`)
