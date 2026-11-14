// Hashes that go on-chain (CLAUDE.md §5): spec_hash, delivery_hash, reason_hash.
// @noble/hashes is synchronous and has no I/O, so the same code runs in Node and in browsers.

import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { canonicalBytes, nfc, utf8 } from "./canonical"
import type { Delivery } from "./delivery"
import type { JobSpec } from "./job"

/** What was hashed, the 32-byte digest, and the digest as 64 lowercase hex digits. */
export type Hashed = { canonical: Uint8Array; hash: Uint8Array; hex: string }

/**
 * `spec_hash = sha256(canonical bytes)` (§5.1). `canonical` is what `/jobs/:ref/spec.json` serves.
 * Hashing does not validate (so a stored spec always re-hashes, whatever the checks become);
 * check the spec with `parseJobSpec` first. Throws `FormatError` for values JSON can't carry.
 */
export function specHash(spec: JobSpec): Hashed {
  return hashBytes(canonicalBytes(spec))
}

/** `delivery_hash = sha256(canonical bytes)` (§5.2). Check the manifest with `parseDelivery` first. */
export function deliveryHash(delivery: Delivery): Hashed {
  return hashBytes(canonicalBytes(delivery))
}

export function sha256(bytes: Uint8Array): Uint8Array {
  return nobleSha256(bytes)
}

/** Lowercase hex, two digits per byte. */
export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes)
}

export function hashBytes(canonical: Uint8Array): Hashed {
  const hash = sha256(canonical)
  return { canonical, hash, hex: toHex(hash) }
}

/** `reason_hash = sha256(NFC(text) as UTF-8)` (§5.3). Hashes the text as given; check it with `parseRejectionReason`. */
export function reasonHash(text: string): Hashed {
  return hashBytes(utf8(nfc(text)))
}
