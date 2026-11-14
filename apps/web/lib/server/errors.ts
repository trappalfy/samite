// JSON errors with stable codes (CLAUDE.md §6.1): { error: { code, message } }. The codes are listed in /docs/errors;
// never rename one (machines branch on them).
import { DrizzleQueryError } from "drizzle-orm/errors"

export const ERROR_STATUS = {
  bad_request: 400,
  auth_missing: 401,
  auth_malformed: 401,
  auth_clock_skew: 401,
  auth_bad_signature: 401,
  auth_replayed: 401,
  session_invalid: 401,
  forbidden: 403,
  not_found: 404,
  chain_state: 409,
  insufficient_funds: 409,
  tx_would_fail: 409,
  payload_too_large: 413,
  spec_invalid: 422,
  spec_refused: 422,
  delivery_invalid: 422,
  hash_mismatch: 422,
  reason_invalid: 422,
  tx_invalid: 422,
  rate_limited: 429,
  internal: 500,
  rpc_unavailable: 502,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message)
  }
  get status() {
    return ERROR_STATUS[this.code]
  }
}

/** JSON that carries bigints (amounts, slots) as decimal strings: JSON numbers can't hold a u64 exactly. */
export function toJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v,
  )
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  return new Response(toJson(data), { ...init, headers })
}

/** An ApiError becomes its JSON; anything else is logged and becomes `internal` (no stack or detail leaks out). */
export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    const body = {
      error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) },
    }
    return json(body, { status: e.status, headers: e.headers })
  }
  console.error(JSON.stringify({ msg: "unhandled", ...describeError(e) }))
  return json({ error: { code: "internal", message: "Something went wrong on our side." } }, { status: 500 })
}

/**
 * What may be logged about an error. A failed query's message carries its SQL parameters (a delivery's text, a note,
 * an address), and so can the database's own message, so for those only the error's name and SQLSTATE code are kept.
 */
export function describeError(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { error: "a non-Error was thrown" }
  const cause = e.cause as { code?: unknown } | undefined
  // DrizzleQueryError doesn't set `name`, so test the class; `severity` marks the database driver's own errors
  if (e instanceof DrizzleQueryError || typeof (e as { severity?: unknown }).severity === "string")
    return { error: "database query failed", code: cause?.code ?? (e as { code?: unknown }).code }
  return { error: e.message, name: e.name }
}
