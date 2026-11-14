// Shared plumbing for the /api/v1 route handlers: one place for errors, bodies, auth and rate limits.
import type { Address } from "@solana/kit"
import { server, type Server } from "./context"
import { ApiError, errorResponse } from "./errors"
import { clientIp, rateLimit, type Limit } from "./rate"
import { authenticate } from "./session"

export type Call = {
  req: Request
  s: Server
  /** The raw body, read once (signed requests hash exactly these bytes). */
  body: Uint8Array
  /** The body parsed as JSON; throws `bad_request` if it isn't. */
  json<T = unknown>(): T
  /** The caller, from a signed request or the session. Rate-limited per address. */
  auth(): Promise<{ address: Address; via: "signed" | "session" }>
}

const MAX_BODY = 256 * 1024 // specs are ≤ 16 KB of instructions; files never go through the API

/** Writes: 60 a minute per IP and 30 a minute per address. Reads: 600 a minute per IP. */
export const LIMITS = {
  writeIp: { max: 60, windowSec: 60 },
  writeAddress: { max: 30, windowSec: 60 },
  readIp: { max: 600, windowSec: 60 },
} satisfies Record<string, Limit>

export function handler<P = Record<string, never>>(fn: (c: Call, params: P) => Promise<Response>) {
  return async (req: Request, ctx?: { params?: Promise<P> }) => {
    try {
      const s = await server()
      const write = req.method !== "GET" && req.method !== "HEAD"
      await rateLimit(s.kv, `ip:${clientIp(req)}:${write ? "w" : "r"}`, write ? LIMITS.writeIp : LIMITS.readIp)
      const body = new Uint8Array(await req.arrayBuffer())
      if (body.length > MAX_BODY) throw new ApiError("payload_too_large", `The body is over ${MAX_BODY / 1024} KB.`)
      let parsed: unknown
      let didParse = false
      const call: Call = {
        req,
        s,
        body,
        json<T>() {
          if (!didParse) {
            try {
              parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
            } catch {
              throw new ApiError("bad_request", "The body must be JSON.")
            }
            didParse = true
          }
          return parsed as T
        },
        async auth() {
          const who = await authenticate(req, body, s.session(req))
          if (write) await rateLimit(s.kv, `addr:${who.address}`, LIMITS.writeAddress)
          return who
        },
      }
      return await fn(call, ((await ctx?.params) ?? {}) as P)
    } catch (e) {
      // which route refused what, so a stuck flow can be traced: the code only (messages and details can carry
      // amounts or text from the request), never the body or the caller
      if (e instanceof ApiError)
        console.log(
          JSON.stringify({ msg: "api_error", method: req.method, path: new URL(req.url).pathname, code: e.code }),
        )
      return errorResponse(e)
    }
  }
}

/** A bigint from a JSON field given as a decimal string or a safe integer; amounts never pass through floats. */
export function bigintField(v: unknown, name: string): bigint {
  if (typeof v === "string" && /^\d{1,20}$/.test(v)) return BigInt(v)
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v)
  throw new ApiError("bad_request", `${name} must be a whole number of base units, as a string ("120000000").`)
}

export function stringField(v: unknown, name: string): string {
  if (typeof v !== "string" || !v) throw new ApiError("bad_request", `${name} is required.`)
  return v
}
