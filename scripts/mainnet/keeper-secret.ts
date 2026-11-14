// pnpm --filter @samite/mainnet exec tsx keeper-secret.ts <keeper keypair.json>
// Prints the keeper's address and its KEEPER_SECRET (base58, what apps/worker reads, CLAUDE.md §7.2). Sends nothing and
// touches no network. Use it only for the keeper's key: never for the admin, the upgrade authority or the treasury.
import { createKeyPairSignerFromBytes, getBase58Decoder, getBase58Encoder } from "@solana/kit"
import { readFileSync } from "node:fs"
import { fail, header } from "./lib"

header([
  "THE KEEPER'S KEY FOR THE WORKER'S SECRET STORE (owner only: CLAUDE.md §7.2, §14 M5)",
  "",
  "What it does:   reads a keypair file and prints KEEPER_SECRET for apps/worker. Nothing is sent.",
  "Which key:      a NEW key made only for the keeper (solana-keygen new -o keeper.json). It pays network fees",
  "                for release, refund and expire-claim transactions and holds no authority over anything.",
  "                Fund it with a little SOL (no more than 0.5 SOL).",
  "Where it goes:  only into the worker host's secret store, with KEEPER_ENABLED=true when you say go.",
])

const path = process.argv[2] ?? fail("pass the keeper's keypair file")
const bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[])
if (bytes.length !== 64) fail("a Solana keypair file holds 64 numbers")
const signer = await createKeyPairSignerFromBytes(bytes)
const secret = getBase58Decoder().decode(bytes)
// the worker decodes it the same way; check the round trip before anyone pastes it anywhere
const back = await createKeyPairSignerFromBytes(getBase58Encoder().encode(secret))
if (back.address !== signer.address) fail("round trip failed; don't use this output")

console.log(`Keeper address: ${signer.address}`)
console.log(`KEEPER_SECRET=${secret}`)
console.log("\nPaste the second line into the worker's secret store only. Clear your terminal afterwards.")
