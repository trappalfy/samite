// Verifying a signed request (CLAUDE.md §6.1): the Authorization header, |now − ts| ≤ 60 s, the ed25519 signature
// over requestMessage(), and no repeat of (address, sig) within 2 minutes.
import {
  getBase58Encoder,
  getPublicKeyFromAddress,
  isAddress,
  signatureBytes,
  verifySignature,
  type Address,
} from "@solana/kit"
import { parseAuthorization, requestMessage } from "@samite/formats"
import { ApiError } from "./errors"
import type { Kv } from "./kv"

export const MAX_SKEW_SEC = 60
export const REPLAY_WINDOW_SEC = 120

export async function verifySignedRequest(
  req: Request,
  body: Uint8Array,
  o: { kv: Kv; now?: () => number },
): Promise<Address> {
  const header = req.headers.get("authorization")
  if (!header)
    throw new ApiError("auth_missing", "This route needs a signed request (Authorization: Samite-Ed25519 …).")
  const auth = parseAuthorization(header)
  if (!auth || !isAddress(auth.address))
    throw new ApiError("auth_malformed", "The Authorization header is not a valid Samite-Ed25519 header.")
  const now = Math.floor((o.now ?? Date.now)() / 1000)
  if (Math.abs(now - auth.ts) > MAX_SKEW_SEC)
    throw new ApiError(
      "auth_clock_skew",
      `ts is ${now - auth.ts} s away from the server's clock; it must be within ${MAX_SKEW_SEC} s.`,
      { serverTime: now },
    )

  let sig
  try {
    const bytes = getBase58Encoder().encode(auth.sig)
    sig = signatureBytes(bytes)
  } catch {
    throw new ApiError("auth_malformed", "sig is not a 64-byte ed25519 signature in base58.")
  }
  const url = new URL(req.url)
  const message = new TextEncoder().encode(
    requestMessage({ method: req.method, pathAndQuery: url.pathname + url.search, ts: auth.ts, body }),
  )
  const key = await getPublicKeyFromAddress(auth.address)
  if (!(await verifySignature(key, sig, message)))
    throw new ApiError("auth_bad_signature", "The signature doesn't match this request and address.")

  // only after the signature checks out, so nobody can fill the store with junk
  if (!(await o.kv.setOnce(`replay:${auth.address}:${auth.sig}`, REPLAY_WINDOW_SEC)))
    throw new ApiError("auth_replayed", "This exact signed request was already used. Sign each request anew.")
  return auth.address
}
