import { describe, expect, it } from "vitest"
import { splitReward } from "@samite/config/money"
import { EXAMPLE_JOB, EXAMPLE_MACHINE, EXAMPLE_JOBS } from "../lib/examples"

// Example data is labelled on every screen, but it must still obey the money rules it illustrates.
describe("example data", () => {
  it("has the board's seven jobs with integer base-unit rewards", () => {
    expect(EXAMPLE_JOBS.map((j) => j.no)).toEqual(["0416", "0415", "0414", "0413", "0411", "0410", "0408"])
    for (const j of EXAMPLE_JOBS) expect(typeof j.reward).toBe("bigint")
  })

  it("pays job 0415's machine 97.5% of the escrow", () => {
    expect(EXAMPLE_JOB.reward).toBe(80_000_000n)
    expect(splitReward(EXAMPLE_JOB.reward, EXAMPLE_JOB.feeBps)).toEqual({ toMachine: 78_000_000n, fee: 2_000_000n })
  })

  it("names the example machine by its self-chosen label", () => {
    expect(EXAMPLE_MACHINE.label).toBe("listing-scout")
    expect(EXAMPLE_MACHINE.earned).toBe(6_418_500_000n)
  })
})
