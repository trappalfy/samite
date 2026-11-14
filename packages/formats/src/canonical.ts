// Samite's canonical form (CLAUDE.md §5.1): every string, property names included, normalised to
// Unicode NFC, then serialised with RFC 8785 JCS and encoded as UTF-8.

import { FormatError, TOO_DEEP, type PathSegment } from "./errors"
import { jcs } from "./jcs"
import { FORMAT_LIMITS } from "./limits"

/**
 * A deep copy of `value` with every string and property name in NFC. Throws `FormatError` for a
 * lone surrogate, or when two property names of one object become the same name.
 */
export function normalizeNfc<T>(value: T): T {
  return walk(value, []) as T
}

/** NFC, then RFC 8785 JCS. */
export function canonicalJson(value: unknown): string {
  return jcs(normalizeNfc(value))
}

/** The UTF-8 bytes of `canonicalJson(value)`: the bytes that get hashed. */
export function canonicalBytes(value: unknown): Uint8Array {
  return utf8(canonicalJson(value))
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** NFC of one string; refuses lone surrogates, which TextEncoder would silently turn into U+FFFD. */
export function nfc(text: string, path: readonly PathSegment[] = []): string {
  if (LONE_SURROGATE.test(text)) throw new FormatError(path, "contains a lone surrogate (invalid Unicode)")
  return text.normalize("NFC")
}

// With the u flag a well-formed pair is one code point, so \p{Cs} only matches unpaired halves.
const LONE_SURROGATE = /\p{Cs}/u

function walk(value: unknown, path: PathSegment[]): unknown {
  if (typeof value === "string") return nfc(value, path)
  if (typeof value === "object" && value !== null && path.length >= FORMAT_LIMITS.maxDepth) {
    throw new FormatError([], TOO_DEEP)
  }
  if (Array.isArray(value)) return Array.from(value, (item: unknown, i) => walk(item, [...path, i]))
  if (typeof value === "object" && value !== null && isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const name = nfc(key, [...path, key])
      if (Object.hasOwn(out, name)) {
        throw new FormatError(path, `has two fields named "${name}" once normalised to Unicode NFC`)
      }
      // defineProperty, not out[name] = …: JSON.parse makes "__proto__" an own key, and assigning
      // it would set the prototype instead (dropping the field and inheriting its contents).
      Object.defineProperty(out, name, {
        value: walk(item, [...path, name]),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return out
  }
  return value // numbers, booleans, null; anything else is left for jcs() to refuse
}

function isPlainObject(o: object): boolean {
  const proto = Object.getPrototypeOf(o) as unknown
  return proto === Object.prototype || proto === null
}
