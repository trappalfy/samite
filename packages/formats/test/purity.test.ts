// CLAUDE.md §7.1: packages/formats is pure, with no I/O, so it runs the same in Node and browsers.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(import.meta.dirname, "..", "src")
const sources = readdirSync(SRC)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }))

const ALLOWED = [/^\.\//, /^zod$/, /^@noble\/hashes\/(sha2|utils)\.js$/]

describe("src is pure", () => {
  it.each(sources.map((s) => [s.file, s.text]))("%s imports only zod, @noble/hashes and itself", (_file, text) => {
    const specifiers = [...text.matchAll(/^\s*(?:import|export)\b[^"']*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!)
    for (const s of specifiers)
      expect(
        ALLOWED.some((re) => re.test(s)),
        s,
      ).toBe(true)
  })

  it.each(sources.map((s) => [s.file, s.text]))("%s uses no I/O, environment or clock", (_file, text) => {
    expect(text).not.toMatch(/\b(fetch|process|require|setTimeout|setInterval|Date\.now|Math\.random)\b|import\(/)
  })
})
