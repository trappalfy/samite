import { describe, expect, it } from "vitest"
import { blur } from "../src/press/blur"

describe("blur", () => {
  it("returns a copy for radius 0", () => {
    const src = new Float32Array([0, 1, 0, 1])
    const out = blur(src, 2, 2, 0)
    expect(Array.from(out)).toEqual([0, 1, 0, 1])
    expect(out).not.toBe(src)
  })

  it("keeps a constant field constant", () => {
    const src = new Float32Array(30).fill(0.4)
    for (const v of blur(src, 6, 5, 2)) expect(v).toBeCloseTo(0.4, 6)
  })

  it("spreads a single bright cell and conserves symmetry", () => {
    const w = 9, h = 9
    const src = new Float32Array(w * h)
    src[4 * w + 4] = 1
    const out = blur(src, w, h, 1)
    expect(out[4 * w + 4]).toBeLessThan(1)
    expect(out[4 * w + 3]).toBeCloseTo(out[4 * w + 5]!, 7)
    expect(out[3 * w + 4]).toBeCloseTo(out[5 * w + 4]!, 7)
    expect(out[0]).toBe(0)
  })
})
