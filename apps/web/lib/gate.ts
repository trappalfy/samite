// samite.fun before launch (the owner's decision, Nov 13): the whole site is closed to everyone but the team until the
// owner sets SAMITE_PUBLIC=1 in Vercel and redeploys. A team member opens it once per browser with the secret link
// https://samite.fun/?access=<SAMITE_ACCESS_KEY>, which leaves a 30-day cookie holding a hash of the key; a machine
// (SDK, MCP) sends the key in the `x-samite-access` header. Everyone else gets a plain 404, and nothing is indexed.
// Checked on every request by proxy.ts, so a build restored from a cache can't open it.
import { isClosed } from "./env"

type Env = Record<string, string | undefined>

export const ACCESS_PARAM = "access"
export const ACCESS_COOKIE = "samite_access"
export const ACCESS_HEADER = "x-samite-access"
export const ACCESS_MAX_AGE = 30 * 86_400
/** A key shorter than this is treated as no key: the site stays closed to everyone. */
export const MIN_KEY_LENGTH = 32

export type Request = { pathname: string; search: URLSearchParams; cookie?: string; header?: string }
export type Decision =
  | { kind: "open" }
  /** The right secret link: set the cookie and go to the same page without the key in the address. */
  | { kind: "grant"; token: string; location: string }
  | { kind: "deny" }

/** What the cookie holds: a hash of the key, so the cookie never carries the key itself. */
export async function accessToken(key: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`samite-access:v1:${key}`))
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Constant-time comparison of two strings. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function decide(req: Request, env: Env = process.env): Promise<Decision> {
  if (!isClosed(env)) return { kind: "open" }
  // robots.txt says "Disallow: /" while closed (app/robots.ts)
  if (req.pathname === "/robots.txt") return { kind: "open" }
  const key = env.SAMITE_ACCESS_KEY ?? ""
  if (key.length < MIN_KEY_LENGTH) return { kind: "deny" }
  const token = await accessToken(key)
  if (req.cookie !== undefined && same(req.cookie, token)) return { kind: "open" }
  if (req.header !== undefined && same(req.header, key)) return { kind: "open" }
  const given = req.search.get(ACCESS_PARAM)
  if (given !== null && same(given, key)) {
    const rest = new URLSearchParams(req.search)
    rest.delete(ACCESS_PARAM)
    const q = rest.toString()
    return { kind: "grant", token, location: req.pathname + (q ? `?${q}` : "") }
  }
  return { kind: "deny" }
}
