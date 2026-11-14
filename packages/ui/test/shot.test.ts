import { describe, expect, it } from "vitest"
import { readShot } from "../src/press/shot"

describe("readShot", () => {
  it("returns the frozen time from ?shot&t=", () => {
    expect(readShot("?shot&t=7")).toBe(7)
    expect(readShot("?t=3.2&shot")).toBe(3.2)
  })

  it("is null without the shot flag", () => {
    expect(readShot("")).toBeNull()
    expect(readShot("?t=7")).toBeNull()
  })

  it("falls back to 0 for a missing, negative or invalid t", () => {
    expect(readShot("?shot")).toBe(0)
    expect(readShot("?shot&t=abc")).toBe(0)
    expect(readShot("?shot&t=-1")).toBe(0)
  })
})
