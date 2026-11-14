// Golden files: the same input must always give the same bytes and hash (CLAUDE.md §5, §13).
//
// How the expectations were produced, independently of this package's code:
//   - test/golden/**/<name>.canonical and <name>.sha256 are written by scripts/golden.py
//     (`pnpm --filter @samite/formats golden`, i.e. `python3 -I scripts/golden.py test/golden`),
//     which uses only Python's standard library: unicodedata.normalize("NFC", ...) on every string
//     and key, json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) and
//     hashlib.sha256. It refuses inputs where that differs from RFC 8785 (floats, integers past
//     2^53 - 1, keys whose code-point and UTF-16 orders differ, duplicate keys), so the inputs here
//     have none; floats and UTF-16 ordering are covered by the RFC vectors in jcs.test.ts.
//   - The two "by hand" cases below were written out by hand and hashed with `shasum -a 256`.
// Regenerate only when an input changes on purpose; a change in the expected bytes of an existing
// input means every hash already on-chain for that kind of input would stop matching.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  canonicalBytes,
  deliveryHash,
  parseDelivery,
  parseJobSpec,
  sha256,
  specHash,
  toHex,
  type Delivery,
  type JobSpec,
} from "../src/index"

const ROOT = join(import.meta.dirname, "golden")

type Golden = { name: string; input: unknown; canonical: Uint8Array; hex: string }

function load(dir: string): Golden[] {
  const names = readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".input.json"))
    .map((f) => f.slice(0, -".input.json".length))
    .sort()
  return names.map((name) => ({
    name,
    input: JSON.parse(readFileSync(join(ROOT, dir, `${name}.input.json`), "utf8")) as unknown,
    canonical: new Uint8Array(readFileSync(join(ROOT, dir, `${name}.canonical`))),
    hex: readFileSync(join(ROOT, dir, `${name}.sha256`), "ascii").trim(),
  }))
}

const specs = load("specs")
const deliveries = load("deliveries")
const values = load("values")

describe("golden files", () => {
  it("are all there", () => {
    expect(specs.map((g) => g.name)).toEqual(["01-text-minimal", "02-file-attachments", "03-url-unicode", "04-limits"])
    expect(deliveries.map((g) => g.name)).toEqual(["01-file", "02-text", "03-url"])
    expect(values.map((g) => g.name)).toEqual(["01-nested"])
  })

  it("each expected hash is the sha256 of its expected bytes", () => {
    for (const g of [...specs, ...deliveries, ...values]) expect(toHex(sha256(g.canonical)), g.name).toBe(g.hex)
  })
})

describe("golden specs", () => {
  for (const g of specs) {
    describe(g.name, () => {
      it("is a valid samite/job@1 spec", () => {
        expect(parseJobSpec(g.input).ok).toBe(true)
      })

      it("gives the expected canonical bytes and spec_hash", () => {
        const r = parseJobSpec(g.input)
        if (!r.ok) throw new Error(JSON.stringify(r.errors))
        const h = specHash(r.spec)
        expect(Buffer.from(h.canonical).toString("utf8")).toBe(Buffer.from(g.canonical).toString("utf8"))
        expect(h.canonical).toEqual(g.canonical)
        expect(h.hex).toBe(g.hex)
        expect(toHex(h.hash)).toBe(g.hex)
        expect(h.hash.length).toBe(32)
      })

      it("hashes the same before parsing, since hashing applies NFC itself", () => {
        expect(specHash(g.input as JobSpec).hex).toBe(g.hex)
      })
    })
  }
})

describe("golden deliveries", () => {
  for (const g of deliveries) {
    describe(g.name, () => {
      it("gives the expected canonical bytes and delivery_hash", () => {
        const r = parseDelivery(g.input)
        if (!r.ok) throw new Error(JSON.stringify(r.errors))
        const h = deliveryHash(r.delivery)
        expect(Buffer.from(h.canonical).toString("utf8")).toBe(Buffer.from(g.canonical).toString("utf8"))
        expect(h.canonical).toEqual(g.canonical)
        expect(h.hex).toBe(g.hex)
      })

      it("hashes the same before parsing", () => {
        expect(deliveryHash(g.input as Delivery).hex).toBe(g.hex)
      })
    })
  }
})

describe("golden values (NFC + JCS on any JSON)", () => {
  for (const g of values) {
    it(`${g.name} gives the expected canonical bytes`, () => {
      expect(Buffer.from(canonicalBytes(g.input)).toString("utf8")).toBe(Buffer.from(g.canonical).toString("utf8"))
      expect(canonicalBytes(g.input)).toEqual(g.canonical)
    })
  }
})

describe("by hand", () => {
  it('{"b":1,"a":"e\\u0301"} → {"a":"\u00e9","b":1}', () => {
    const bytes = canonicalBytes({ b: 1, a: "e\u0301" })
    expect(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ")).toBe(
      "7b 22 61 22 3a 22 c3 a9 22 2c 22 62 22 3a 31 7d",
    )
    expect(toHex(sha256(bytes))).toBe("aa58fba8483623bed37c1b02edfccbdd9a53123837c20bfa4cb4049993a2872e")
  })

  it("the url delivery, written out by hand, matches its golden file", () => {
    const handWritten =
      '{"attempt":3,"job":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","kind":"url",' +
      '"url":"https://github.com/example/repo/pull/7?tab=files&w=1#diff-3","v":"samite/delivery@1"}'
    const golden = deliveries.find((g) => g.name === "03-url")!
    expect(Buffer.from(golden.canonical).toString("utf8")).toBe(handWritten)
    expect(golden.hex).toBe("168904acb216f495b2e8ee1c66f62032023d6d5d8df728245bea688ea79893fc")
  })
})
