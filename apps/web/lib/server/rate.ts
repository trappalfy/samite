// Rate limits per address and per IP (§6.1): fixed windows in the shared store.
import { ApiError } from "./errors"
import type { Kv } from "./kv"

export type Limit = { max: number; windowSec: number }

export async function rateLimit(kv: Kv, key: string, l: Limit, now: () => number = Date.now) {
  const window = Math.floor(now() / 1000 / l.windowSec)
  const n = await kv.incr(`rate:${key}:${window}`, l.windowSec)
  if (n > l.max) {
    const retryAfter = (window + 1) * l.windowSec - Math.floor(now() / 1000)
    throw new ApiError("rate_limited", `Too many requests. Try again in ${retryAfter} s.`, undefined, {
      "retry-after": String(retryAfter),
    })
  }
  return { remaining: l.max - n }
}

/** The client's IP as Vercel reports it (first hop of x-forwarded-for); "local" when there's none. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local"
}
