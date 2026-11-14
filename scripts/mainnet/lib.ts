// Shared by the owner-run mainnet scripts. Every script: dry by default (prints what it would send and what it costs),
// refuses any cluster but mainnet (genesis hash), reads keys only from paths given on the command line (never env,
// CLAUDE.md §7.3), and sends only with --go after the owner types GO.
// `--rehearse-local` runs the same script against the local validator (`pnpm --filter @samite/local run up`) and
// nothing else: it refuses any URL but the local one, and refuses if that URL somehow answers with mainnet's genesis.
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit"
import { MAINNET_GENESIS_HASH } from "@samite/config/solana"

export function args() {
  const a = process.argv.slice(2)
  const get = (name: string) => {
    const i = a.indexOf(`--${name}`)
    return i >= 0 ? a[i + 1] : undefined
  }
  return { get, go: a.includes("--go"), need: (name: string) => get(name) ?? fail(`--${name} is required`) }
}

export function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

export async function signerFrom(path: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))))
}

const LOCAL_RPC = "http://127.0.0.1:8899"
/** True when the script was started with --rehearse-local (and mainnetRpc accepted the local validator). */
export let rehearsal = false
export const network = () => (rehearsal ? "the LOCAL validator (rehearsal)" : "MAINNET")

/** A mainnet RPC, or the script stops: these scripts never run anywhere else by mistake. */
export async function mainnetRpc(url: string | undefined) {
  if (!url) fail("--rpc is required (a mainnet RPC URL)")
  const rpc = createSolanaRpc(url)
  const genesis = await rpc.getGenesisHash().send()
  if (process.argv.includes("--rehearse-local")) {
    if (url !== LOCAL_RPC) fail(`--rehearse-local runs only against the local validator at ${LOCAL_RPC}`)
    if (genesis === MAINNET_GENESIS_HASH) fail("--rehearse-local refused: this RPC answers with mainnet's genesis")
    rehearsal = true
    console.log(`REHEARSAL on the local validator (genesis ${genesis}). Nothing here touches mainnet.\n`)
    return rpc
  }
  if (genesis !== MAINNET_GENESIS_HASH) fail(`this RPC is not mainnet (genesis ${genesis})`)
  return rpc
}
export type Rpc = Awaited<ReturnType<typeof mainnetRpc>>

export const sol = (lamports: bigint) => `${(Number(lamports) / 1e9).toFixed(6)} SOL`

export function header(lines: string[]) {
  console.log(`\n${"=".repeat(78)}\n${lines.join("\n")}\n${"=".repeat(78)}\n`)
}

/** Asks the owner to type GO. Without --go the script has already stopped before this. */
export async function confirmGo(what: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Type GO to ${what} on ${network()} (anything else stops): `)
  rl.close()
  if (answer.trim() !== "GO") fail("stopped; nothing was sent")
}

export async function send(rpc: Rpc, payer: KeyPairSigner, ixs: Instruction[]): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  )
  const signed = await signTransactionMessageWithSigners(msg)
  const sig = getSignatureFromTransaction(signed)
  try {
    await rpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send()
  } catch (e) {
    // usually a refused preflight (nothing was sent): show the program's own logs so the reason is readable
    const err = e as Error & { context?: { logs?: string[] }; cause?: unknown }
    const logs = err.context?.logs ?? []
    fail(
      `the RPC did not accept ${sig} (if this was a network error, look it up on an explorer before retrying): ${err.message}${err.cause ? ` (${JSON.stringify(err.cause, (_k, v) => (typeof v === "bigint" ? v.toString() : v))})` : ""}${logs.length ? `\n  ${logs.join("\n  ")}` : ""}`,
    )
  }
  for (let i = 0; i < 120; i++) {
    const { value } = await rpc.getSignatureStatuses([sig as Signature]).send()
    if (value[0]?.err) fail(`failed on-chain: ${JSON.stringify(value[0].err)} (${sig})`)
    if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") return sig
    await new Promise((r) => setTimeout(r, 1000))
  }
  fail(`not confirmed after 2 minutes: ${sig}; check it on an explorer before retrying`)
}
