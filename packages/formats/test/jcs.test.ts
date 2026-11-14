import { describe, expect, it } from "vitest"
import { FormatError, jcs } from "../src/index"
import {
  NUMBER_SAMPLES,
  PRIMITIVES_EXPECTED_HEX,
  PRIMITIVES_INPUT,
  SORTING_EXPECTED_VALUES,
  SORTING_INPUT,
} from "./fixtures/rfc8785"

function doubleFromHex(hex: string): number {
  const view = new DataView(new ArrayBuffer(8))
  view.setBigUint64(0, BigInt(`0x${hex}`))
  return view.getFloat64(0)
}

const utf8Hex = (text: string) =>
  Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join(" ")

describe("jcs: RFC 8785 test vectors", () => {
  describe("Appendix B number samples", () => {
    for (const { ieee, json, comment } of NUMBER_SAMPLES) {
      const label = `${ieee}${comment ? ` (${comment})` : ""}`
      if (json === null) {
        it(`refuses ${label}`, () => {
          expect(() => jcs(doubleFromHex(ieee))).toThrow(FormatError)
        })
      } else {
        it(`serialises ${label} as ${json}`, () => {
          expect(jcs(doubleFromHex(ieee))).toBe(json)
        })
      }
    }
  })

  it("sorts the §3.2.3 properties by UTF-16 code units", () => {
    const out = jcs(JSON.parse(SORTING_INPUT))
    // Read the order off the output text: re-parsing it would let JS move the key "1" first.
    const values = [...out.matchAll(/:"([^"]*)"/g)].map((m) => m[1])
    expect(values).toEqual(SORTING_EXPECTED_VALUES)
    expect(out).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis",' +
        '"€":"Euro Sign","😀":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    )
  })

  it("serialises the §3.2.2 sample to the §3.2.4 bytes", () => {
    const expected = PRIMITIVES_EXPECTED_HEX.trim().split(/\s+/).join(" ")
    expect(utf8Hex(jcs(JSON.parse(PRIMITIVES_INPUT)))).toBe(expected)
  })
})

describe("jcs: strings (§3.2.2.2)", () => {
  it("uses the short escapes for \\b \\t \\n \\f \\r", () => {
    expect(jcs("\b\t\n\f\r")).toBe('"\\b\\t\\n\\f\\r"')
  })

  it("escapes the other C0 controls as lowercase \\u00hh", () => {
    expect(jcs("\u0000\u0001\u000b\u001f")).toBe('"\\u0000\\u0001\\u000b\\u001f"')
  })

  it("escapes only the quote and the backslash among printable characters", () => {
    expect(jcs('"\\/')).toBe('"\\"\\\\/"')
  })

  it("writes DEL, U+2028, non-ASCII and emoji as is", () => {
    expect(jcs("\u007f\u2028\u00e9😀")).toBe('"\u007f\u2028\u00e9😀"')
  })

  it("does not normalise Unicode itself (§3.1: preserve string data as is)", () => {
    expect(jcs("e\u0301")).toBe('"e\u0301"')
  })

  it("refuses a lone high surrogate", () => {
    expect(() => jcs("a\ud83d")).toThrow(FormatError)
  })

  it("refuses a lone low surrogate", () => {
    expect(() => jcs("\ude00b")).toThrow(FormatError)
  })

  it("refuses a lone surrogate in a property name", () => {
    expect(() => jcs({ "\udead": 1 })).toThrow(FormatError)
  })
})

describe("jcs: structure", () => {
  it("writes literals", () => {
    expect(jcs([null, true, false])).toBe("[null,true,false]")
  })

  it("emits no whitespace", () => {
    expect(jcs({ a: [1, { b: 2 }], c: {} })).toBe('{"a":[1,{"b":2}],"c":{}}')
  })

  it("sorts nested objects and keeps array order", () => {
    expect(jcs({ z: [{ y: 1, x: 2 }, 3], a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"z":[{"x":2,"y":1},3]}')
  })

  it("sorts shorter keys first when one is a prefix of the other", () => {
    expect(jcs({ ab: 1, aa: 2, a: 3, "": 4 })).toBe('{"":4,"a":3,"aa":2,"ab":1}')
  })

  it("leaves out properties whose value is undefined, as JSON.stringify does", () => {
    expect(jcs({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it("refuses undefined as a value or array element", () => {
    expect(() => jcs(undefined)).toThrow(FormatError)
    expect(() => jcs([1, undefined])).toThrow(FormatError)
  })

  it("refuses a hole in a sparse array instead of writing [1,,2]", () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(() => jcs([1, , 2])).toThrow(FormatError)
  })

  it("writes an own __proto__ property (as JSON.parse makes) like any other key", () => {
    expect(jcs(JSON.parse('{"b":1,"__proto__":{"x":1}}'))).toBe('{"__proto__":{"x":1},"b":1}')
  })

  it.each([
    ["a bigint", 1n],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["a Uint8Array", new Uint8Array(1)],
  ])("refuses %s", (_name, value) => {
    expect(() => jcs({ value })).toThrow(FormatError)
  })

  it("accepts objects with a null prototype", () => {
    const o = Object.create(null) as Record<string, number>
    o.b = 1
    o.a = 2
    expect(jcs(o)).toBe('{"a":2,"b":1}')
  })

  it("refuses nesting deeper than 100 levels with a FormatError, not a stack overflow", () => {
    let v: unknown = 1
    for (let i = 0; i < 100; i++) v = { a: v }
    expect(() => jcs(v)).not.toThrow()
    expect(() => jcs([v])).toThrow(FormatError)
    for (let i = 0; i < 100_000; i++) v = [v]
    expect(() => jcs(v)).toThrow(FormatError)
  })

  it("refuses a cycle", () => {
    const o: Record<string, unknown> = {}
    o.self = o
    expect(() => jcs(o)).toThrow(FormatError)
  })

  it("allows the same object twice when it is not a cycle", () => {
    const shared = { x: 1 }
    expect(jcs([shared, shared])).toBe('[{"x":1},{"x":1}]')
  })

  it("says where the bad value is", () => {
    expect(() => jcs({ a: [0, { b: Number.NaN }] })).toThrow(/a\[1\]\.b/)
  })
})
