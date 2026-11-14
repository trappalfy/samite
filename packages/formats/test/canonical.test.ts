import { describe, expect, it } from "vitest"
import { canonicalBytes, canonicalJson, FormatError, normalizeNfc } from "../src/index"
import { SORTING_INPUT } from "./fixtures/rfc8785"

describe("normalizeNfc", () => {
  it("composes a decomposed \u00e9 in a value", () => {
    expect(normalizeNfc({ city: "Cafe\u0301" })).toEqual({ city: "Caf\u00e9" })
  })

  it("composes property names too", () => {
    expect(Object.keys(normalizeNfc({ "Cafe\u0301": 1 }))).toEqual(["Caf\u00e9"])
  })

  it("reaches strings inside nested arrays and objects", () => {
    expect(normalizeNfc({ a: [{ b: ["e\u0301"] }] })).toEqual({ a: [{ b: ["\u00e9"] }] })
  })

  it("maps a singleton decomposition (U+212B ANGSTROM SIGN → U+00C5)", () => {
    expect(normalizeNfc("\u212b")).toBe("\u00c5")
  })

  it("reorders combining marks into canonical order", () => {
    // dot below (ccc 220) sorts before dot above (ccc 230)
    expect(normalizeNfc("q\u0307\u0323")).toBe("q\u0323\u0307")
  })

  it("composes Hangul jamo into a syllable", () => {
    expect(normalizeNfc("\u1112\u1161\u11ab")).toBe("\ud55c")
  })

  it("is NFC, not NFKC: ligatures and full-width letters stay", () => {
    expect(normalizeNfc("\ufb01 \uff21")).toBe("\ufb01 \uff21")
  })

  it("does not change the input", () => {
    const input = { "e\u0301": ["e\u0301"] }
    normalizeNfc(input)
    expect(input).toEqual({ "e\u0301": ["e\u0301"] })
  })

  it("copies an own __proto__ property as a property, not as the prototype", () => {
    const out = normalizeNfc(JSON.parse('{"__proto__":{"polluted":1}}')) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(["__proto__"])
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(out.polluted).toBeUndefined()
    expect(canonicalJson(JSON.parse('{"a":1,"__proto__":2}'))).toBe('{"__proto__":2,"a":1}')
  })

  it("refuses nesting deeper than 100 levels", () => {
    const nest = (depth: number): unknown => {
      let v: unknown = "leaf"
      for (let i = 0; i < depth; i++) v = [v]
      return v
    }
    expect(() => normalizeNfc(nest(100))).not.toThrow()
    expect(() => normalizeNfc(nest(101))).toThrow(FormatError)
    expect(() => canonicalJson(nest(100_000))).toThrow(FormatError)
  })

  it("leaves numbers, booleans and null alone", () => {
    expect(normalizeNfc([1, true, null])).toEqual([1, true, null])
  })

  it("refuses two property names that are the same after NFC", () => {
    const input = { "\u00e9": 1, "e\u0301": 2 }
    expect(() => normalizeNfc(input)).toThrow(FormatError)
    expect(() => normalizeNfc({ outer: input })).toThrow(/outer/)
  })

  it("refuses a lone surrogate and says where it is", () => {
    expect(() => normalizeNfc({ list: ["ok", "\ud800"] })).toThrow(FormatError)
    expect(() => normalizeNfc({ list: ["ok", "\ud800"] })).toThrow(/list\[1\]/)
  })
})

describe("canonicalJson", () => {
  it("normalises to NFC, then serialises with JCS", () => {
    expect(canonicalJson({ b: "Cafe\u0301", a: 1 })).toBe('{"a":1,"b":"Caf\u00e9"}')
  })

  it("sorts by the NFC form of the keys", () => {
    // U+FB33 is a composition exclusion: NFC turns it into U+05D3 U+05BC, which sorts before U+20AC.
    // So the order differs from the plain-JCS order in RFC 8785 §3.2.3.
    const keys = [...canonicalJson(JSON.parse(SORTING_INPUT)).matchAll(/"([^"]*)":/g)].map((m) => m[1])
    expect(keys).toEqual(["\\r", "1", "\u0080", "\u00f6", "\u05d3\u05bc", "\u20ac", "\u{1f600}"])
  })
})

describe("canonicalBytes", () => {
  it("is the UTF-8 encoding of the canonical JSON", () => {
    expect(Array.from(canonicalBytes({ k: "e\u0301" }))).toEqual([
      0x7b,
      0x22,
      0x6b,
      0x22,
      0x3a,
      0x22,
      0xc3,
      0xa9,
      0x22,
      0x7d, // {"k":"<U+00E9>"}
    ])
  })

  it("encodes emoji as four UTF-8 bytes", () => {
    expect(Array.from(canonicalBytes("😀"))).toEqual([0x22, 0xf0, 0x9f, 0x98, 0x80, 0x22])
  })
})
