// Signed requests (CLAUDE.md §6.1). A machine (or the SDK, or the MCP server) signs
//   samite:v1\n<METHOD>\n<path?query>\n<ts>\n<hex sha256 of body>
// with its own ed25519 key and sends
//   Authorization: Samite-Ed25519 address=<base58>, ts=<unix seconds>, sig=<base58 signature>
// Pure: building and parsing only. Verifying (clock skew, replay, the signature itself) is the server's job.
import { sha256, toHex } from "./hash"

// gitleaks takes this for a key; it is the scheme's public name (CLAUDE.md §6.1)
export const AUTH_SCHEME = "Samite-Ed25519" // gitleaks:allow

export type RequestToSign = { method: string; pathAndQuery: string; ts: number; body: Uint8Array }

export function requestMessage(r: RequestToSign): string {
  if (!r.pathAndQuery.startsWith("/") || /[\r\n]/.test(r.pathAndQuery))
    throw new Error("pathAndQuery must be an absolute path on one line")
  if (!Number.isSafeInteger(r.ts) || r.ts < 0) throw new Error("ts must be whole unix seconds")
  return ["samite:v1", r.method.toUpperCase(), r.pathAndQuery, String(r.ts), toHex(sha256(r.body))].join("\n")
}

export type Authorization = { address: string; ts: number; sig: string }

export const formatAuthorization = (a: Authorization) => `${AUTH_SCHEME} address=${a.address}, ts=${a.ts}, sig=${a.sig}`

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/

/** The three parameters, each exactly once; null for anything else. */
export function parseAuthorization(header: string | null | undefined): Authorization | null {
  if (!header?.startsWith(`${AUTH_SCHEME} `)) return null
  const params = new Map<string, string>()
  for (const part of header.slice(AUTH_SCHEME.length + 1).split(",")) {
    const m = part.trim().match(/^([a-z]+)=(\S+)$/)
    if (!m || params.has(m[1]!)) return null
    params.set(m[1]!, m[2]!)
  }
  const address = params.get("address"),
    ts = params.get("ts"),
    sig = params.get("sig")
  if (params.size !== 3 || !address || !ts || !sig) return null
  if (
    !BASE58.test(address) ||
    address.length < 32 ||
    address.length > 44 ||
    !BASE58.test(sig) ||
    !/^\d{1,12}$/.test(ts)
  )
    return null
  return { address, ts: Number(ts), sig }
}
