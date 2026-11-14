import { describe, expect, it } from "vitest"
import { byteCount, charCount } from "../src/index"

describe("charCount: Unicode code points after NFC", () => {
  it("counts ASCII one per character", () => {
    expect(charCount("abc")).toBe(3)
  })

  it("counts a decomposed \u00e9 as one, because NFC composes it", () => {
    expect(charCount("e\u0301")).toBe(1)
  })

  it("counts an emoji as one even though it is two UTF-16 units", () => {
    expect("😀".length).toBe(2)
    expect(charCount("😀")).toBe(1)
  })

  it("counts every code point of an emoji sequence", () => {
    expect(charCount("👍\u{1f3fd}")).toBe(2) // thumbs up + skin tone modifier
  })

  it("counts decomposed Hangul jamo as one syllable", () => {
    expect(charCount("\u1112\u1161\u11ab")).toBe(1)
  })
})

describe("byteCount: UTF-8 bytes after NFC", () => {
  it("counts ASCII one byte per character", () => {
    expect(byteCount("abc")).toBe(3)
  })

  it("counts \u00e9 as two bytes whichever form it arrives in", () => {
    expect(byteCount("\u00e9")).toBe(2)
    expect(byteCount("e\u0301")).toBe(2)
  })

  it("counts an emoji as four bytes", () => {
    expect(byteCount("😀")).toBe(4)
  })
})
