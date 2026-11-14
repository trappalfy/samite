// RFC 8785 JSON Canonicalization Scheme (JCS). https://www.rfc-editor.org/rfc/rfc8785
//
// Strings are written as they are (§3.1: JCS itself never normalises Unicode; Samite's NFC step
// runs before this, see canonical.ts). Lone surrogates, NaN and ±Infinity are refused (§3.2.2).

import { FormatError, TOO_DEEP, type PathSegment } from "./errors"
import { FORMAT_LIMITS } from "./limits"

/** Serialise a JSON value per RFC 8785. Throws `FormatError` for anything JSON can't express exactly. */
export function jcs(value: unknown): string {
  return serialise(value, [], new Set())
}

function serialise(value: unknown, path: PathSegment[], open: Set<object>): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false"
    case "number":
      return serialiseNumber(value, path)
    case "string":
      return serialiseString(value, path)
    case "object":
      break
    default:
      throw new FormatError(path, `${describe(value)} is not a JSON value`)
  }

  const object = value as object
  if (open.has(object)) throw new FormatError(path, "the value contains itself (a cycle)")
  if (path.length >= FORMAT_LIMITS.maxDepth) throw new FormatError([], TOO_DEEP)
  open.add(object)
  let out: string
  if (Array.isArray(object)) {
    // Array.from visits holes too (as undefined, refused below); map would skip them and write "[1,,2]".
    out = `[${Array.from(object, (item: unknown, i) => serialise(item, [...path, i], open)).join(",")}]`
  } else if (isPlainObject(object)) {
    const record = object as Record<string, unknown>
    const parts: string[] = []
    // Default sort compares UTF-16 code units, which is what §3.2.3 asks for.
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      if (item === undefined) continue // absent, as JSON.stringify treats it
      parts.push(`${serialiseString(key, path)}:${serialise(item, [...path, key], open)}`)
    }
    out = `{${parts.join(",")}}`
  } else {
    throw new FormatError(path, `${describe(value)} is not a JSON value`)
  }
  open.delete(object)
  return out
}

/** §3.2.2.3: ECMAScript Number::toString, which is what String(n) is. */
function serialiseNumber(n: number, path: PathSegment[]): string {
  if (!Number.isFinite(n)) throw new FormatError(path, `${n} is not allowed in JSON`)
  return String(n) // -0 → "0", 1e21 → "1e+21", as Appendix B expects
}

/** §3.2.2.2. */
function serialiseString(s: string, path: PathSegment[]): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdfff) {
      const next = s.charCodeAt(i + 1)
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        out += s[i]! + s[i + 1]!
        i++
        continue
      }
      throw new FormatError(path, `lone surrogate U+${c.toString(16).toUpperCase()} is not valid Unicode`)
    }
    if (c === 0x22) out += '\\"'
    else if (c === 0x5c) out += "\\\\"
    else if (c < 0x20) out += SHORT_ESCAPES[c] ?? `\\u${c.toString(16).padStart(4, "0")}`
    else out += s[i]!
  }
  return `${out}"`
}

const SHORT_ESCAPES: Record<number, string> = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r" }

function isPlainObject(o: object): boolean {
  const proto = Object.getPrototypeOf(o) as unknown
  return proto === Object.prototype || proto === null
}

function describe(value: unknown): string {
  if (typeof value === "object" && value !== null) return `a ${value.constructor?.name ?? "non-plain object"}`
  return `a ${typeof value}`
}
