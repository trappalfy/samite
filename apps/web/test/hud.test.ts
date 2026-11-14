import { describe, expect, it } from "vitest"
import { hudState, STAGE } from "../app/(site)/(home)/hud"

// The hero HUD (CLAUDE.md §11.6): one example job through OPEN → CLAIMED → DELIVERED → PAID, 1.9 s each.
describe("hudState", () => {
  it("opens job 0417 at t = 0", () => {
    const h = hudState(0)
    expect(STAGE).toBe(1.9)
    expect(h.state).toBe(0)
    expect(h.lines).toEqual(["JOB 0417", "120.00 USDC", "OPEN"])
  })

  it("claims, delivers and pays", () => {
    expect(hudState(1.9 + 0.5).lines).toEqual(["JOB 0417", "CLAIMED", "BY 7f3a…c91e"])
    expect(hudState(3.8 + 0.1).lines).toEqual(["JOB 0417", "DELIVERED", "HASH 9be2…04aa"])
    expect(hudState(5.7 + 0.1).lines).toEqual(["JOB 0417", "PAID 117.00", "→ 7f3a…c91e"])
  })

  it("moves on to the next example job", () => {
    expect(hudState(7.6).lines).toEqual(["JOB 0418", "40.00 USDC", "OPEN"])
    expect(hudState(7.6 * 2 + 5.8).lines).toEqual(["JOB 0419", "PAID 253.50", "→ a90f…1d4e"])
    expect(hudState(7.6 * 3 + 0.1).lines[0]).toBe("JOB 0417")
  })

  it("reports progress through the state", () => {
    expect(hudState(1.9 * 0.5).u).toBeCloseTo(0.5, 10)
  })

  it("shows the PAID frame, fully drawn, under reduced motion", () => {
    const h = hudState(3.3, { reduced: true })
    expect(h.state).toBe(3)
    expect(h.u).toBe(1)
    expect(h.lines).toEqual(["JOB 0417", "PAID 117.00", "→ 7f3a…c91e"])
  })
})
