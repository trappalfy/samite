import { describe, expect, it } from "vitest"
import { breatheAt, cycleAt, smooth, STILL, type Params } from "../src/press/schedule"

function expectParams(p: Params, want: Params) {
  for (const k of Object.keys(want) as (keyof Params)[]) expect(p[k], k).toBeCloseTo(want[k], 12)
}

// Values from CLAUDE.md §11.5 and design/prototype/samite-press.js.
describe("smooth", () => {
  it("is a clamped smoothstep", () => {
    expect(smooth(0, 1, -1)).toBe(0)
    expect(smooth(0, 1, 2)).toBe(1)
    expect(smooth(0, 1, 0.5)).toBe(0.5)
    expect(smooth(0, 1, 0.25)).toBeCloseTo(0.15625, 12)
  })
})

describe("cycleAt", () => {
  it("starts in ink: crisp letters with a fringe of small dots", () => {
    expectParams(cycleAt(0), { a: 1, b: 0.3, c: 0, gain: 1.7, th: 0.02, sc: 0 })
  })

  it("holds the bloom row and eases its gain from 1.35 to 1.2", () => {
    const p = cycleAt(0.35)
    expect(p.a).toBeCloseTo(0.8, 12)
    expect(p.b).toBeCloseTo(0.9, 12)
    expect(p.c).toBeCloseTo(0.55, 12)
    expect(p.gain).toBeCloseTo(1.275, 12)
  })

  it("dims at .50 and scatters at .58", () => {
    expectParams(cycleAt(0.5), { a: 0.6, b: 0.8, c: 0.5, gain: 0.5, th: 0, sc: 0 })
    expectParams(cycleAt(0.58), { a: 0.8, b: 0.5, c: 0.2, gain: 1.1, th: 0.05, sc: 0.85 })
  })

  it("is a chunky blob between .66 and .80 and ink again at the end", () => {
    expectParams(cycleAt(0.7), { a: 1, b: 0.45, c: 0, gain: 2.4, th: 0.22, sc: 0 })
    expectParams(cycleAt(1), { a: 1, b: 0.3, c: 0, gain: 1.7, th: 0.02, sc: 0 })
  })
})

describe("breatheAt", () => {
  it("follows the §11.5 formula", () => {
    const P = 5.2
    const t = 1.3
    const s = Math.sin((t / P) * Math.PI * 2)
    const s2 = Math.sin((t / (P * 1.7)) * Math.PI * 2 + 1.3)
    expectParams(breatheAt(t, P), { a: 1, b: 0.55 + 0.25 * s, c: 0.35 + 0.2 * s2, gain: 1.25 + 0.12 * s, th: 0.03, sc: 0 })
  })
})

describe("STILL", () => {
  it("is the reduced-motion print", () => {
    expectParams(STILL, { a: 1, b: 0.45, c: 0.25, gain: 1.4, th: 0.03, sc: 0 })
  })
})
