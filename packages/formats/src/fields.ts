// Field schemas shared by the formats. Each custom check reports a predicate ("must be 8–120
// characters (it has 5).") that issues.ts prefixes with the field's label.

import { z } from "zod"
import { FORMAT_LIMITS } from "./limits"
import { byteCount, charCount } from "./text"

type Ctx = { value: unknown; issues: unknown[] }

function fail(ctx: Ctx, message: string): void {
  ctx.issues.push({ code: "custom", message, input: ctx.value })
}

export const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const isBlank = (s: string) => s.trim() === ""
// C0 and C1 controls, DEL, and the Unicode line and paragraph separators.
const CONTROL_OR_BREAK = /[\p{Cc}\u2028\u2029]/u

/** Text measured in characters (code points after NFC). */
export function chars(opts: { min: number; max: number; singleLine?: boolean }) {
  return z.string().check((ctx) => {
    const s = ctx.value
    if (opts.min > 0 && isBlank(s)) return fail(ctx, "can't be blank.")
    const n = charCount(s)
    if (n < opts.min || n > opts.max) {
      return fail(ctx, `must be ${thousands(opts.min)}–${thousands(opts.max)} characters (it has ${thousands(n)}).`)
    }
    if (opts.singleLine && CONTROL_OR_BREAK.test(s)) {
      fail(ctx, "must be one line (no line breaks or control characters).")
    }
  })
}

/** Optional text with only an upper bound, e.g. a note. */
export function charsAtMost(max: number) {
  return z.string().check((ctx) => {
    const n = charCount(ctx.value)
    if (n > max) fail(ctx, `must be at most ${thousands(max)} characters (it has ${thousands(n)}).`)
  })
}

/** Non-blank text measured in UTF-8 bytes after NFC. `pronoun` makes the message read right. */
export function utf8Bytes(opts: { maxBytes: number; pronoun: "it is" | "they are" }) {
  return z.string().check((ctx) => {
    if (isBlank(ctx.value)) return fail(ctx, "can't be blank.")
    const n = byteCount(ctx.value)
    if (n > opts.maxBytes) {
      const kb = opts.maxBytes / 1024
      fail(
        ctx,
        `must be at most ${kb} KB (${thousands(opts.maxBytes)} bytes) as UTF-8 (${opts.pronoun} ${thousands(n)} bytes).`,
      )
    }
  })
}

/** A whole number in [min, max]. Refuses non-safe integers: past 2^53 JSON numbers stop being exact. */
export function integer(opts: { min: number; max: number; unit?: string }) {
  return z.number().check((ctx) => {
    const n = ctx.value
    if (!Number.isSafeInteger(n)) return fail(ctx, "must be a whole number.")
    if (n < opts.min || n > opts.max)
      fail(ctx, `must be ${thousands(opts.min)}–${thousands(opts.max)}${opts.unit ?? ""}.`)
  })
}

/** An array with an item count in [min, max]. */
export function list<T extends z.ZodType>(item: T, opts: { min: number; max: number }) {
  return z.array(item).check((ctx) => {
    const n = ctx.value.length
    if (n < opts.min || n > opts.max) fail(ctx, `must have ${opts.min}–${opts.max} items (there are ${n}).`)
  })
}

export const sha256Hex = z.string().check((ctx) => {
  if (!/^[0-9a-f]{64}$/.test(ctx.value)) fail(ctx, "must be 64 lowercase hex characters.")
})

/** An absolute https URL with a host, no credentials, no spaces or control characters. */
export const httpsUrl = z.string().check((ctx) => {
  const s = ctx.value
  const n = charCount(s)
  if (n > FORMAT_LIMITS.urlMaxChars) {
    return fail(ctx, `must be at most ${thousands(FORMAT_LIMITS.urlMaxChars)} characters (it has ${thousands(n)}).`)
  }
  if (/[\s\p{Cc}]/u.test(s)) return fail(ctx, "must be a URL without spaces.")
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return fail(ctx, "must be a full URL starting with https://.")
  }
  if (url.protocol !== "https:" || url.hostname === "") return fail(ctx, "must be a full URL starting with https://.")
  if (url.username !== "" || url.password !== "") fail(ctx, "must not contain a user name or password.")
})

/** A file name, not a path: 1–255 characters, no / or \, no control characters, not "." or "..". */
export const fileName = z.string().check((ctx) => {
  const s = ctx.value
  const n = charCount(s)
  if (n < 1 || n > FORMAT_LIMITS.fileNameMaxChars) {
    return fail(ctx, `must be 1–${FORMAT_LIMITS.fileNameMaxChars} characters (it has ${thousands(n)}).`)
  }
  if (/[/\\]/.test(s) || s === "." || s === "..") return fail(ctx, "must be a file name, not a path.")
  if (CONTROL_OR_BREAK.test(s)) fail(ctx, "must not contain control characters.")
})

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

/** Base58 (Bitcoin alphabet) decode; null for a character outside the alphabet. */
export function decodeBase58(s: string): Uint8Array | null {
  const bytes: number[] = []
  for (const ch of s) {
    let carry = BASE58.indexOf(ch)
    if (carry < 0) return null
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (const ch of s) {
    if (ch !== "1") break
    bytes.push(0) // each leading "1" is a leading zero byte
  }
  return Uint8Array.from(bytes.reverse())
}

/** A Solana address: base58 that decodes to exactly 32 bytes. (Whether it is a PDA is the chain's to say.) */
export const solanaAddress = z.string().check((ctx) => {
  // 32 bytes are at most 44 base58 characters; refuse longer strings before the quadratic decode.
  const bytes = ctx.value.length <= 44 ? decodeBase58(ctx.value) : null
  if (bytes === null || bytes.length !== 32) fail(ctx, "must be a Solana address (base58, 32 bytes).")
})
