// pnpm --filter @samite/mainnet exec tsx initialize-config.ts --rpc <mainnet RPC> --authority <upgrade authority keypair.json> --treasury-owner <address> [--go]
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit"
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTokenSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token"
import { formatUsdc } from "@samite/config/money"
import { LIMITS, USDC_MINT } from "@samite/config/solana"
import {
  CONFIG_ACCOUNT_BYTES,
  eventCpiAccounts,
  fetchMaybeConfig,
  findConfigPda,
  getInitializeConfigInstructionAsync,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
} from "@samite/program-client"
import { args, confirmGo, fail, header, mainnetRpc, send, signerFrom, sol } from "./lib"

header([
  "INITIALIZE THE ESCROW CONFIG ON MAINNET (owner only: CLAUDE.md §4.3, §14 M5)",
  "",
  "What it sends:  one transaction: creates the treasury's USDC account if it doesn't exist (the associated token",
  "                account of --treasury-owner), then initialize_config with fee 250 bps (2.5%) and a minimum",
  "                reward of 1 USDC. The signer becomes the config's ADMIN (it can change the fee for new jobs,",
  "                up to 5%, pause new posts and claims, and change the treasury; it can never move escrowed money).",
  "From which key: --authority, which must be the program's upgrade authority (the program checks it). Keep it",
  "                offline; it never goes into any server's environment.",
  "What it costs:  rent for the Config account and, if missing, for the treasury's USDC account (both read live",
  "                below), plus one network fee (0.000005 SOL).",
  "Not sent:       nothing, unless you pass --go and type GO.",
])

const a = args()
const rpc = await mainnetRpc(a.get("rpc"))
const authority = await signerFrom(a.need("authority"))
const treasuryOwner = address(a.need("treasury-owner"))
const mint = address(USDC_MINT)

// the mint must be what CLAUDE.md §3.1 says USDC is: classic SPL Token, 6 decimals
const mintInfo = (await rpc.getAccountInfo(mint, { encoding: "jsonParsed" }).send()).value
const parsed = mintInfo?.data as { parsed?: { type: string; info: { decimals: number } } } | undefined
if (mintInfo?.owner !== TOKEN_PROGRAM_ADDRESS || parsed?.parsed?.type !== "mint" || parsed.parsed.info.decimals !== 6)
  fail(`${USDC_MINT} is not a 6-decimal SPL Token mint on this cluster`)

const program = (await rpc.getAccountInfo(SAMITE_ESCROW_PROGRAM_ADDRESS, { encoding: "base64" }).send()).value
if (!program?.executable)
  fail(`the program ${SAMITE_ESCROW_PROGRAM_ADDRESS} is not deployed on this cluster yet (run deploy-program.ts first)`)
const [configPda] = await findConfigPda()
if ((await fetchMaybeConfig(rpc, configPda)).exists) fail("the config already exists; changes go through update_config")

const [treasury] = await findAssociatedTokenPda({ owner: treasuryOwner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS })
const treasuryExists = !!(await rpc.getAccountInfo(treasury, { encoding: "base64" }).send()).value
const [programData] = await getProgramDerivedAddress({
  programAddress: address("BPFLoaderUpgradeab1e11111111111111111111111"),
  seeds: [getAddressEncoder().encode(SAMITE_ESCROW_PROGRAM_ADDRESS)],
})
// 8 + Config::INIT_SPACE (181 bytes; packages/local's bootstrap checks it against the account initialize_config creates)
const configRent = await rpc.getMinimumBalanceForRentExemption(BigInt(CONFIG_ACCOUNT_BYTES)).send()
const ataRent = treasuryExists ? 0n : await rpc.getMinimumBalanceForRentExemption(BigInt(getTokenSize())).send()

console.log(`Program:         ${SAMITE_ESCROW_PROGRAM_ADDRESS}`)
console.log(`Admin (signer):  ${authority.address}`)
console.log(`Treasury owner:  ${treasuryOwner}`)
console.log(`Treasury (USDC): ${treasury} ${treasuryExists ? "(exists)" : "(created by this transaction)"}`)
console.log(
  `Fee:             ${LIMITS.feeBps} bps (${LIMITS.feeBps / 100}%) of every payout; nothing on refunds or cancels`,
)
console.log(`Minimum reward:  ${formatUsdc(LIMITS.minRewardBaseUnits)} USDC`)
console.log(
  `Cost:            ${sol(configRent + ataRent + 5_000n)} (Config rent ${sol(configRent)}${treasuryExists ? "" : `, treasury account rent ${sol(ataRent)}`}, fee ${sol(5_000n)})`,
)
if (!a.go) {
  console.log("\nDry run: nothing was sent. Add --go to send.")
  process.exit(0)
}
await confirmGo("initialize the config")
const ixs = [
  await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: authority, owner: treasuryOwner, mint }),
  await getInitializeConfigInstructionAsync({
    authority,
    usdcMint: mint,
    treasuryOwner,
    treasury,
    programData,
    feeBps: LIMITS.feeBps,
    minReward: LIMITS.minRewardBaseUnits,
    ...(await eventCpiAccounts()),
  }),
]
console.log(
  `\n✓ Config initialized: ${await send(rpc, authority, ixs)}\nNext: first-job.ts with a 1–5 USDC reward and a second wallet as the machine.`,
)
