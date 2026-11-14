import { LIMITS } from "@samite/config"
import { describe, expect, it } from "vitest"
import { FORMAT_LIMITS, parseDelivery, type Issue } from "../src/index"

const HEX = "2f9c4d1e8b7a6f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0e01d0e1"
const JOB = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" // 32 bytes in base58 (an example, not a real job)

const base = { v: "samite/delivery@1", job: JOB, attempt: 1 }

function fileDelivery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...base,
    kind: "file",
    files: [{ name: "listings.csv", bytes: 1468211, sha256: HEX }],
    note: "All 2,000 rows. 14 listings had no area; left empty as allowed in the spec.",
    ...overrides,
  }
}

function errors(input: unknown): Issue[] {
  const r = parseDelivery(input)
  if (r.ok) throw new Error("expected the delivery to be refused")
  return r.errors
}

function errorAt(input: unknown, path: string): string {
  const found = errors(input).filter((e) => e.path === path)
  expect(found, `errors at ${path}: ${JSON.stringify(errors(input))}`).toHaveLength(1)
  return found[0]!.message
}

function accepts(input: unknown) {
  const r = parseDelivery(input)
  if (!r.ok) throw new Error(`expected the delivery to be accepted: ${JSON.stringify(r.errors)}`)
  return r.delivery
}

describe("parseDelivery: valid deliveries", () => {
  it("accepts the §5.2 file example", () => {
    expect(accepts(fileDelivery())).toEqual(fileDelivery())
  })

  it("accepts a text delivery", () => {
    accepts({ ...base, kind: "text", text: "The answer is 42." })
  })

  it("accepts a url delivery", () => {
    accepts({ ...base, kind: "url", url: "https://github.com/example/repo/pull/7" })
  })

  it("returns the delivery in NFC", () => {
    expect(accepts(fileDelivery({ note: "Cafe\u0301 rows done" })).note).toBe("Caf\u00e9 rows done")
  })
})

describe("parseDelivery: the envelope", () => {
  it("must be an object", () => {
    expect(errorAt("delivery", "")).toBe("The delivery must be a JSON object.")
  })

  it("requires v = samite/delivery@1", () => {
    const { v: _v, ...rest } = fileDelivery()
    expect(errorAt(rest, "v")).toBe("Version (v) is required.")
    expect(errorAt(fileDelivery({ v: "samite/job@1" }), "v")).toBe('Version (v) must be "samite/delivery@1".')
  })

  it("refuses unknown fields", () => {
    expect(errorAt(fileDelivery({ signature: "x" }), "signature")).toBe(
      'The delivery has an unknown field "signature".',
    )
  })

  it("refuses a payload field of another kind", () => {
    expect(errorAt(fileDelivery({ text: "hi" }), "text")).toBe('The delivery has an unknown field "text".')
  })

  it("requires a known kind", () => {
    const { kind: _k, ...rest } = fileDelivery()
    expect(errorAt(rest, "kind")).toBe("Kind is required.")
    expect(errorAt(fileDelivery({ kind: "zip" }), "kind")).toBe("Kind must be one of: file, text, url.")
  })
})

describe("parseDelivery: job (base58 address)", () => {
  it.each([
    "11111111111111111111111111111111", // 32 zero bytes
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // the USDC mint: 44 characters
  ])("accepts %s", (job) => {
    accepts(fileDelivery({ job }))
  })

  it.each([
    ["empty", ""],
    ["too short", "abc"],
    ["one byte too long (33 bytes)", "1EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    ["0 is not base58", "0PjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    ["I is not base58", "IPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    ["l is not base58", "lPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    ["a space", " EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ])("refuses %s", (_name, job) => {
    expect(errorAt(fileDelivery({ job }), "job")).toBe("Job must be a Solana address (base58, 32 bytes).")
  })

  it("refuses a very long job string without decoding it (base58 decoding is quadratic)", () => {
    const started = performance.now()
    expect(errorAt(fileDelivery({ job: "z".repeat(50_000) }), "job")).toBe(
      "Job must be a Solana address (base58, 32 bytes).",
    )
    expect(performance.now() - started).toBeLessThan(100)
  })
})

describe("parseDelivery: attempt (1..3)", () => {
  it("is the program's max deliveries", () => {
    expect(FORMAT_LIMITS.delivery.maxAttempt).toBe(LIMITS.maxDeliveries)
  })

  it.each([1, 2, 3])("accepts %i", (attempt) => {
    accepts(fileDelivery({ attempt }))
  })

  it.each([0, 4, -1])("refuses %i", (attempt) => {
    expect(errorAt(fileDelivery({ attempt }), "attempt")).toBe("Attempt must be 1–3.")
  })

  it.each([1.5, "1", 2 ** 53, Number.POSITIVE_INFINITY])("refuses %j as not a whole number", (attempt) => {
    expect(errorAt(fileDelivery({ attempt }), "attempt")).toBe("Attempt must be a whole number.")
  })
})

describe("parseDelivery: files", () => {
  const file = (i: number) => ({ name: `part-${i}.csv`, bytes: 10, sha256: HEX })

  it("needs 1 to 100 files", () => {
    accepts(fileDelivery({ files: Array.from({ length: 100 }, (_, i) => file(i)) }))
    expect(errorAt(fileDelivery({ files: [] }), "files")).toBe("Files must have 1–100 items (there are 0).")
    expect(errorAt(fileDelivery({ files: Array.from({ length: 101 }, (_, i) => file(i)) }), "files")).toBe(
      "Files must have 1–100 items (there are 101).",
    )
  })

  it("requires files for kind file", () => {
    const { files: _f, ...rest } = fileDelivery()
    expect(errorAt(rest, "files")).toBe("Files is required.")
  })

  it("accepts 0 bytes and 200 MB, refuses more", () => {
    accepts(fileDelivery({ files: [{ ...file(0), bytes: 0 }] }))
    accepts(fileDelivery({ files: [{ ...file(0), bytes: 209_715_200 }] }))
    expect(errorAt(fileDelivery({ files: [{ ...file(0), bytes: 209_715_201 }] }), "files[0].bytes")).toBe(
      "File 1 bytes must be 0–209,715,200.",
    )
  })

  it("refuses a fractional size", () => {
    expect(errorAt(fileDelivery({ files: [{ ...file(0), bytes: 10.5 }] }), "files[0].bytes")).toBe(
      "File 1 bytes must be a whole number.",
    )
  })

  it("checks sha256 and name like attachments", () => {
    expect(errorAt(fileDelivery({ files: [{ ...file(0), sha256: HEX.toUpperCase() }] }), "files[0].sha256")).toBe(
      "File 1 sha256 must be 64 lowercase hex characters.",
    )
    expect(errorAt(fileDelivery({ files: [{ ...file(0), name: "../etc/passwd" }] }), "files[0].name")).toBe(
      "File 1 name must be a file name, not a path.",
    )
  })

  it("refuses two files with the same name", () => {
    const files = [file(0), file(1), { ...file(2), name: "part-0.csv" }]
    expect(errorAt(fileDelivery({ files }), "files[2].name")).toBe("File 3 name is already used by file 1.")
  })
})

describe("parseDelivery: text (≤ 64 KB of UTF-8)", () => {
  const text = (t: unknown) => ({ ...base, kind: "text", text: t })

  it("accepts 65,536 bytes and refuses one more", () => {
    accepts(text("a".repeat(65_536)))
    expect(errorAt(text("a".repeat(65_537)), "text")).toBe(
      "Text must be at most 64 KB (65,536 bytes) as UTF-8 (it is 65,537 bytes).",
    )
  })

  it("refuses blank text", () => {
    expect(errorAt(text(" \n"), "text")).toBe("Text can't be blank.")
  })

  it("requires text for kind text", () => {
    expect(errorAt({ ...base, kind: "text" }, "text")).toBe("Text is required.")
  })
})

describe("parseDelivery: url", () => {
  it("must be https", () => {
    expect(errorAt({ ...base, kind: "url", url: "http://example.com" }, "url")).toBe(
      "URL must be a full URL starting with https://.",
    )
  })
})

describe("parseDelivery: note (optional, ≤ 1,000 characters)", () => {
  it("is optional and may be empty", () => {
    const { note: _n, ...rest } = fileDelivery()
    accepts(rest)
    accepts(fileDelivery({ note: "" }))
  })

  it("accepts 1,000 characters, counted as code points", () => {
    accepts(fileDelivery({ note: "😀".repeat(1_000) }))
  })

  it("refuses 1,001 characters", () => {
    expect(errorAt(fileDelivery({ note: "a".repeat(1_001) }), "note")).toBe(
      "Note must be at most 1,000 characters (it has 1,001).",
    )
  })
})
