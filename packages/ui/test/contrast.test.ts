import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { contrast, parseColor } from "../src/contrast"

// CLAUDE.md §11.2 / §13: every text/background pair must reach 4.5:1.
const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8")
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`no token --${name}`)
  return m[1]!.trim()
}

describe("contrast", () => {
  it("computes WCAG ratios", () => {
    expect(contrast(parseColor("#000"), parseColor("#fff"))).toBeCloseTo(21, 5)
    expect(contrast(parseColor("#777"), parseColor("#777"))).toBeCloseTo(1, 5)
  })

  it("composites translucent text over its background", () => {
    const c = parseColor("rgba(255, 255, 255, 0.5)")
    expect(c.a).toBe(0.5)
    expect(contrast(c, parseColor("#000"))).toBeCloseTo(contrast(parseColor("#808080"), parseColor("#000")), 1)
  })
})

describe("token pairs", () => {
  const onBlack = ["cream", "text-2", "text-3"]
  const blacks = ["bg", "panel", "panel-2"]
  for (const fg of onBlack)
    for (const bg of blacks)
      it(`--${fg} on --${bg} ≥ 4.5`, () => {
        expect(contrast(parseColor(token(fg)), parseColor(token(bg)))).toBeGreaterThanOrEqual(4.5)
      })

  for (const fg of ["ink", "muted"])
    it(`--${fg} on --cream ≥ 4.5`, () => {
      expect(contrast(parseColor(token(fg)), parseColor(token("cream")))).toBeGreaterThanOrEqual(4.5)
    })

  it("--muted on black stays below 4.5 (it is never text there)", () => {
    expect(contrast(parseColor(token("muted")), parseColor(token("bg")))).toBeLessThan(4.5)
  })
})
