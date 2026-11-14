import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { MARK_ASPECT, SAMITE_MARK } from "../src/press/mark"

describe("SAMITE_MARK", () => {
  it("is byte-identical to the owner's mark path", () => {
    const ref = readFileSync(new URL("../../../design/prototype/samite-mark.js", import.meta.url), "utf8")
    expect(ref).toContain(`d: '${SAMITE_MARK.d}'`)
  })

  it("has the 1.2716 aspect the lockups use", () => {
    expect(MARK_ASPECT).toBeCloseTo(1.2716, 4)
  })
})
