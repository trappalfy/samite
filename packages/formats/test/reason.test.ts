import { describe, expect, it } from "vitest"
import { parseRejectionReason, reasonHash } from "../src/index"

function errorOf(input: unknown): string {
  const r = parseRejectionReason(input)
  if (r.ok) throw new Error("expected the reason to be refused")
  expect(r.errors).toHaveLength(1)
  expect(r.errors[0]!.path).toBe("")
  return r.errors[0]!.message
}

describe("parseRejectionReason (plain text, 10–1,000 characters)", () => {
  it("accepts 10 and 1,000 characters", () => {
    expect(parseRejectionReason("a".repeat(10))).toEqual({ ok: true, reason: "a".repeat(10) })
    expect(parseRejectionReason("a".repeat(1_000)).ok).toBe(true)
  })

  it("refuses 9 and 1,001 characters", () => {
    expect(errorOf("a".repeat(9))).toBe("Reason must be 10–1,000 characters (it has 9).")
    expect(errorOf("a".repeat(1_001))).toBe("Reason must be 10–1,000 characters (it has 1,001).")
  })

  it("counts code points after NFC", () => {
    expect(parseRejectionReason("😀".repeat(10)).ok).toBe(true)
    expect(errorOf("e\u0301".repeat(9))).toMatch(/\(it has 9\)/)
  })

  it("keeps line breaks", () => {
    expect(parseRejectionReason("Row 12 is empty.\nRow 40 too.").ok).toBe(true)
  })

  it("returns the NFC form, which hashes like the raw text", () => {
    const raw = "Cafe\u0301 rows are missing."
    const r = parseRejectionReason(raw)
    if (!r.ok) throw new Error("expected ok")
    expect(r.reason).toBe("Caf\u00e9 rows are missing.")
    expect(reasonHash(r.reason).hex).toBe(reasonHash(raw).hex)
  })

  it("refuses blank text", () => {
    expect(errorOf(" ".repeat(12))).toBe("Reason can't be blank.")
  })

  it.each([undefined, null, 42, { text: "a reason here" }])("refuses %j as not text", (input) => {
    expect(errorOf(input)).toBe("Reason must be text.")
  })

  it("refuses a lone surrogate", () => {
    expect(errorOf("Bad bytes \udc00 here")).toBe("Reason contains a lone surrogate (invalid Unicode).")
  })
})
