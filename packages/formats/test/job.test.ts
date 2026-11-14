import { describe, expect, it } from "vitest"
import { FORMAT_LIMITS, parseJobSpec, type Issue } from "../src/index"

const HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

/** The §5.1 example, completed. */
function spec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: "samite/job@1",
    title: "Label 5,000 product images by category",
    instructions: "Images: https://example.com/batch-07.zip. One row per image: filename, category.",
    accepted_when: ["CSV has 5,000 rows and no empty category", "I will spot-check 100 rows; 97 or more must be right"],
    deliverable: { kind: "file", max_bytes: 209715200 },
    category: "data",
    attachments: [{ name: "batch-07.zip", url: "https://example.com/batch-07.zip", sha256: HEX }],
    ...overrides,
  }
}

function errors(input: unknown): Issue[] {
  const r = parseJobSpec(input)
  if (r.ok) throw new Error("expected the spec to be refused")
  return r.errors
}

/** The one error message for `path`, failing if there is none. */
function errorAt(input: unknown, path: string): string {
  const found = errors(input).filter((e) => e.path === path)
  expect(found, `errors at ${path}`).toHaveLength(1)
  return found[0]!.message
}

function accepts(input: unknown) {
  const r = parseJobSpec(input)
  if (!r.ok) throw new Error(`expected the spec to be accepted: ${JSON.stringify(r.errors)}`)
  return r
}

describe("parseJobSpec: a valid spec", () => {
  it("accepts the §5.1 example and returns it with no warnings", () => {
    const r = accepts(spec())
    expect(r.spec).toEqual(spec())
    expect(r.warnings).toEqual([])
  })

  it("returns the spec in NFC", () => {
    const r = accepts(spec({ title: "Cafe\u0301 menu photos, 40 items" }))
    expect(r.spec.title).toBe("Caf\u00e9 menu photos, 40 items")
  })

  it("does not change the input", () => {
    const input = spec({ title: "Cafe\u0301 menu photos, 40 items" })
    accepts(input)
    expect(input.title).toBe("Cafe\u0301 menu photos, 40 items")
  })
})

describe("parseJobSpec: the input", () => {
  it.each([null, "a spec", 42, [], undefined])("refuses %j as not an object", (input) => {
    expect(errorAt(input, "")).toBe("The job spec must be a JSON object.")
  })

  it("requires v", () => {
    const { v: _v, ...rest } = spec()
    expect(errorAt(rest, "v")).toBe("Version (v) is required.")
  })

  it("refuses another version", () => {
    expect(errorAt(spec({ v: "samite/job@2" }), "v")).toBe('Version (v) must be "samite/job@1".')
  })

  it("refuses unknown fields", () => {
    expect(errorAt(spec({ reward: 5 }), "reward")).toBe('The job spec has an unknown field "reward".')
  })

  it("refuses a __proto__ field instead of letting it set inherited fields", () => {
    const { attachments: _a, ...rest } = spec()
    const text = JSON.stringify(rest).replace(/^\{/, '{"__proto__":{"attachments":[]},')
    expect(errorAt(JSON.parse(text), "__proto__")).toBe('The job spec has an unknown field "__proto__".')
  })

  it("returns an error, not a crash, for absurdly deep input", () => {
    let title: unknown = "x"
    for (let i = 0; i < 100_000; i++) title = [title]
    expect(errorAt(spec({ title }), "")).toBe("The job spec is nested more than 100 levels deep.")
  })

  it("reports every problem at once", () => {
    const paths = errors(spec({ title: "short", category: "art", accepted_when: [] })).map((e) => e.path)
    expect(paths).toEqual(expect.arrayContaining(["title", "category", "accepted_when"]))
  })

  it("refuses two fields that are the same name after NFC", () => {
    const input = { ...spec(), "titl\u00e9": "x", "title\u0301": "y" }
    expect(errorAt(input, "")).toBe('The job spec has two fields named "titl\u00e9" once normalised to Unicode NFC.')
  })

  it("refuses a lone surrogate as invalid Unicode instead of throwing", () => {
    expect(errorAt(spec({ title: "Label images \ud800 now" }), "title")).toBe(
      "Title contains a lone surrogate (invalid Unicode).",
    )
  })
})

describe("parseJobSpec: title (8–120 characters)", () => {
  it("accepts 8 and 120 characters", () => {
    accepts(spec({ title: "a".repeat(8) }))
    accepts(spec({ title: "a".repeat(120) }))
  })

  it("refuses 7 and 121 characters, saying how many there are", () => {
    expect(errorAt(spec({ title: "a".repeat(7) }), "title")).toBe("Title must be 8–120 characters (it has 7).")
    expect(errorAt(spec({ title: "a".repeat(121) }), "title")).toBe("Title must be 8–120 characters (it has 121).")
  })

  it("counts code points, not UTF-16 units: 120 emoji fit", () => {
    accepts(spec({ title: "😀".repeat(120) }))
    expect(errorAt(spec({ title: "😀".repeat(121) }), "title")).toMatch(/\(it has 121\)/)
  })

  it("counts after NFC: 120 decomposed \u00e9 (240 code points as typed) fit", () => {
    accepts(spec({ title: "e\u0301".repeat(120) }))
  })

  it("refuses a line break", () => {
    expect(errorAt(spec({ title: "Label images\nby category" }), "title")).toBe(
      "Title must be one line (no line breaks or control characters).",
    )
  })

  it("refuses a blank title", () => {
    expect(errorAt(spec({ title: " ".repeat(10) }), "title")).toBe("Title can't be blank.")
  })

  it("requires text", () => {
    const { title: _t, ...rest } = spec()
    expect(errorAt(rest, "title")).toBe("Title is required.")
    expect(errorAt(spec({ title: 12345678 }), "title")).toBe("Title must be text.")
  })
})

describe("parseJobSpec: instructions (Markdown, ≤ 16 KB of UTF-8)", () => {
  it("is 16,384 bytes", () => {
    expect(FORMAT_LIMITS.job.instructionsMaxBytes).toBe(16_384)
  })

  it("accepts exactly 16,384 bytes and refuses one more", () => {
    accepts(spec({ instructions: "a".repeat(16_384) }))
    expect(errorAt(spec({ instructions: "a".repeat(16_385) }), "instructions")).toBe(
      "Instructions must be at most 16 KB (16,384 bytes) as UTF-8 (they are 16,385 bytes).",
    )
  })

  it("counts UTF-8 bytes: 8,192 \u00e9 fit, 8,193 do not", () => {
    accepts(spec({ instructions: "\u00e9".repeat(8_192) }))
    expect(errorAt(spec({ instructions: "\u00e9".repeat(8_193) }), "instructions")).toMatch(/16,386 bytes/)
  })

  it("keeps line breaks and tabs", () => {
    const instructions = "# Steps\n\n1. Download.\n\t- then label each image.\n"
    expect(accepts(spec({ instructions })).spec.instructions).toBe(instructions)
  })

  it("refuses blank instructions", () => {
    expect(errorAt(spec({ instructions: "" }), "instructions")).toBe("Instructions can't be blank.")
    expect(errorAt(spec({ instructions: "\n  \n" }), "instructions")).toBe("Instructions can't be blank.")
  })
})

describe("parseJobSpec: accepted_when (1–10 items, each ≤ 280 characters)", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => `Criterion number ${i + 1} holds`)

  it("accepts 1 and 10 items", () => {
    accepts(spec({ accepted_when: items(1) }))
    accepts(spec({ accepted_when: items(10) }))
  })

  it("refuses 0 and 11 items", () => {
    expect(errorAt(spec({ accepted_when: [] }), "accepted_when")).toBe(
      "Acceptance criteria must have 1–10 items (there are 0).",
    )
    expect(errorAt(spec({ accepted_when: items(11) }), "accepted_when")).toBe(
      "Acceptance criteria must have 1–10 items (there are 11).",
    )
  })

  it("accepts an item of 280 characters and refuses 281", () => {
    accepts(spec({ accepted_when: ["x".repeat(280)] }))
    expect(errorAt(spec({ accepted_when: ["fine criterion here", "x".repeat(281)] }), "accepted_when[1]")).toBe(
      "Acceptance criterion 2 must be 1–280 characters (it has 281).",
    )
  })

  it("refuses a blank item", () => {
    expect(errorAt(spec({ accepted_when: ["  "] }), "accepted_when[0]")).toBe("Acceptance criterion 1 can't be blank.")
  })

  it("must be a list of text", () => {
    expect(errorAt(spec({ accepted_when: "all rows" }), "accepted_when")).toBe("Acceptance criteria must be a list.")
    expect(errorAt(spec({ accepted_when: [7] }), "accepted_when[0]")).toBe("Acceptance criterion 1 must be text.")
  })
})

describe("parseJobSpec: deliverable", () => {
  it("accepts text, url, and file up to 200 MB", () => {
    accepts(spec({ deliverable: { kind: "text" } }))
    accepts(spec({ deliverable: { kind: "url" } }))
    accepts(spec({ deliverable: { kind: "file", max_bytes: 1 } }))
    accepts(spec({ deliverable: { kind: "file", max_bytes: 209_715_200 } }))
  })

  it("refuses a file limit over 200 MB or under 1 byte", () => {
    const message = "Deliverable max_bytes must be 1–209,715,200 bytes (200 MB)."
    expect(errorAt(spec({ deliverable: { kind: "file", max_bytes: 209_715_201 } }), "deliverable.max_bytes")).toBe(
      message,
    )
    expect(errorAt(spec({ deliverable: { kind: "file", max_bytes: 0 } }), "deliverable.max_bytes")).toBe(message)
  })

  it.each([1.5, Number.POSITIVE_INFINITY, Number.NaN, "100"])("refuses max_bytes %j as not a whole number", (n) => {
    expect(errorAt(spec({ deliverable: { kind: "file", max_bytes: n } }), "deliverable.max_bytes")).toBe(
      "Deliverable max_bytes must be a whole number.",
    )
  })

  it("refuses an integer beyond 2^53 as not a whole number JSON can carry", () => {
    expect(errorAt(spec({ deliverable: { kind: "file", max_bytes: 2 ** 53 } }), "deliverable.max_bytes")).toBe(
      "Deliverable max_bytes must be a whole number.",
    )
  })

  it("requires max_bytes for a file", () => {
    expect(errorAt(spec({ deliverable: { kind: "file" } }), "deliverable.max_bytes")).toBe(
      "Deliverable max_bytes is required.",
    )
  })

  it("refuses an unknown kind, or none", () => {
    const message = "Deliverable kind must be one of: text, file, url."
    expect(errorAt(spec({ deliverable: { kind: "zip" } }), "deliverable.kind")).toBe(message)
    expect(errorAt(spec({ deliverable: {} }), "deliverable.kind")).toBe("Deliverable kind is required.")
  })

  it("refuses fields that do not belong to the kind", () => {
    expect(errorAt(spec({ deliverable: { kind: "text", max_bytes: 10 } }), "deliverable.max_bytes")).toBe(
      'Deliverable has an unknown field "max_bytes".',
    )
  })

  it("must be an object", () => {
    expect(errorAt(spec({ deliverable: "file" }), "deliverable")).toBe("Deliverable must be a JSON object.")
  })
})

describe("parseJobSpec: category", () => {
  it.each(["data", "code", "research", "compute", "devices", "other"])("accepts %s", (category) => {
    accepts(spec({ category }))
  })

  it("refuses anything else", () => {
    expect(errorAt(spec({ category: "art" }), "category")).toBe(
      "Category must be one of: data, code, research, compute, devices, other.",
    )
  })
})

describe("parseJobSpec: attachments (optional, ≤ 10)", () => {
  const attachment = (i: number) => ({ name: `part-${i}.zip`, url: `https://example.com/${i}.zip`, sha256: HEX })
  const list = (n: number) => Array.from({ length: n }, (_, i) => attachment(i))

  it("are optional, and may be empty", () => {
    const { attachments: _a, ...rest } = spec()
    accepts(rest)
    accepts(spec({ attachments: [] }))
  })

  it("accepts 10 and refuses 11", () => {
    accepts(spec({ attachments: list(10) }))
    expect(errorAt(spec({ attachments: list(11) }), "attachments")).toBe(
      "Attachments must have 0–10 items (there are 11).",
    )
  })

  it.each([HEX.toUpperCase(), HEX.slice(1), `${HEX}0`, `${HEX.slice(1)}g`])("refuses sha256 %s", (sha256) => {
    expect(errorAt(spec({ attachments: [{ ...attachment(0), sha256 }] }), "attachments[0].sha256")).toBe(
      "Attachment 1 sha256 must be 64 lowercase hex characters.",
    )
  })

  it.each([
    "http://example.com/a.zip",
    "javascript:alert(1)",
    "example.com/a.zip",
    "https://",
    "https://example.com/a b.zip",
    " https://example.com/a.zip",
    "https://user:pass@example.com/a.zip",
  ])("refuses url %j", (url) => {
    expect(errorAt(spec({ attachments: [{ ...attachment(0), url }] }), "attachments[0].url")).toMatch(
      /^Attachment 1 URL must /,
    )
  })

  it("refuses a url over 2,048 characters", () => {
    const url = `https://example.com/${"a".repeat(2_029)}`
    expect(url.length).toBe(2_049)
    expect(errorAt(spec({ attachments: [{ ...attachment(0), url }] }), "attachments[0].url")).toBe(
      "Attachment 1 URL must be at most 2,048 characters (it has 2,049).",
    )
  })

  it.each(["a/b.zip", "a\\b.zip", "..", ".", "", "tab\there.zip", "x".repeat(256)])("refuses name %j", (name) => {
    expect(errorAt(spec({ attachments: [{ ...attachment(0), name }] }), "attachments[0].name")).toMatch(
      /^Attachment 1 name /,
    )
  })

  it("accepts a non-ASCII name of 255 characters", () => {
    accepts(spec({ attachments: [{ ...attachment(0), name: `${"\u00fc".repeat(251)}.zip` }] }))
  })

  it("requires every field", () => {
    const { url: _u, ...noUrl } = attachment(0)
    expect(errorAt(spec({ attachments: [noUrl] }), "attachments[0].url")).toBe("Attachment 1 URL is required.")
  })
})

describe("parseJobSpec: warnings", () => {
  it("warns when the instructions are under 40 characters", () => {
    const r = accepts(spec({ instructions: "Label the images." }))
    expect(r.warnings).toEqual([
      { path: "instructions", message: "Instructions are short (17 characters). Machines do better with details." },
    ])
  })

  it("does not warn at 40 characters", () => {
    expect(accepts(spec({ instructions: "x".repeat(40) })).warnings).toEqual([])
  })

  it("warns about a criterion under 12 characters", () => {
    const r = accepts(spec({ accepted_when: ["CSV has 5,000 rows", "Looks good"] }))
    expect(r.warnings).toEqual([
      {
        path: "accepted_when[1]",
        message: "Acceptance criterion 2 is short (10 characters). Say what a reviewer can check.",
      },
    ])
  })

  it("warns about a criterion that repeats another", () => {
    const r = accepts(spec({ accepted_when: ["CSV has 5,000 rows", "No empty category", "CSV has 5,000 rows"] }))
    expect(r.warnings).toEqual([{ path: "accepted_when[2]", message: "Acceptance criterion 3 repeats criterion 1." }])
  })
})
