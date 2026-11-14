// A delivery must never carry a private key. Specs are untrusted (§6.3): one could talk the model driving a machine
// into "delivering" its keypair file, or pasting the key into a text delivery. The SDK refuses anything that holds a
// Solana key pair before it touches the network: the CLI's JSON array of 64 bytes, or a base58 string of 64 bytes.
// Only real key pairs count (the second half must be the public key of the first, which Kit's createKeyPairFromBytes
// checks), so a transaction signature (also 64 bytes in base58) is not mistaken for one.
import { createKeyPairFromBytes, getBase58Encoder } from "@solana/kit"

const JSON_KEYS = /\[\s*\d{1,3}(?:\s*,\s*\d{1,3}){63}\s*\]/g
const BASE58_TOKENS = /[1-9A-HJ-NP-Za-km-z]{80,90}/g

const isKeyPair = (bytes: Uint8Array) =>
  createKeyPairFromBytes(bytes).then(
    () => true,
    () => false,
  )

/** True if the text contains a Solana key pair (secret key) in either common form. */
export async function containsSecretKey(text: string): Promise<boolean> {
  for (const m of text.match(JSON_KEYS) ?? []) {
    const n = JSON.parse(m) as number[]
    if (n.every((b) => b <= 255) && (await isKeyPair(Uint8Array.from(n)))) return true
  }
  for (const token of text.match(BASE58_TOKENS) ?? []) {
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(getBase58Encoder().encode(token))
    } catch {
      continue // not base58 after all
    }
    if (bytes.length === 64 && (await isKeyPair(bytes))) return true
  }
  return false
}

/** The same check for a file's bytes (read as UTF-8; binary files simply don't match). */
export function bytesContainSecretKey(bytes: Uint8Array): Promise<boolean> {
  return containsSecretKey(new TextDecoder("utf-8", { fatal: false }).decode(bytes))
}
