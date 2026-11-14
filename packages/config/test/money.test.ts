import { describe, expect, it } from "vitest"
import { formatUsdc, parseUsdc, shortAddress, splitReward } from "../src/money"

describe("splitReward (CLAUDE.md §4.5)", () => {
  it("pays 97.5% to the machine and 2.5% to Samite", () => {
    expect(splitReward(120_000_000n, 250)).toEqual({ toMachine: 117_000_000n, fee: 3_000_000n })
    expect(splitReward(80_000_000n, 250)).toEqual({ toMachine: 78_000_000n, fee: 2_000_000n })
  })

  it("floors the fee and never loses a base unit", () => {
    for (let r = 1n; r <= 100_000n; r += 7n) {
      const { toMachine, fee } = splitReward(r, 250)
      expect(fee).toBe((r * 250n) / 10_000n)
      expect(toMachine + fee).toBe(r)
    }
  })

  it("rejects a fee above the cap", () => {
    expect(() => splitReward(1_000_000n, 501)).toThrow()
  })
})

describe("formatUsdc", () => {
  it("shows at least two decimals and groups thousands", () => {
    expect(formatUsdc(117_000_000n)).toBe("117.00")
    expect(formatUsdc(6_418_500_000n)).toBe("6,418.50")
    expect(formatUsdc(0n)).toBe("0.00")
  })

  it("never rounds unless asked: the machine's 0.975 USDC showed as 0.98 (Nov 15)", () => {
    expect(formatUsdc(975_000n)).toBe("0.975")
    expect(formatUsdc(25_000n)).toBe("0.025")
    expect(formatUsdc(24_375_000n)).toBe("24.375")
    expect(formatUsdc(4_040_001n)).toBe("4.040001")
    expect(formatUsdc(24_375_000n, { decimals: 2 })).toBe("24.38")
    expect(formatUsdc(48_210_400_000n, { decimals: 0 })).toBe("48,210")
  })

  it("shows a split part exactly, so the parts always add up to the reward", () => {
    expect(formatUsdc(975_000n, { decimals: "exact" })).toBe("0.975")
    expect(formatUsdc(25_000n, { decimals: "exact" })).toBe("0.025")
    expect(formatUsdc(4_875_000n, { decimals: "exact" })).toBe("4.875")
    expect(formatUsdc(1_234_567n, { decimals: "exact" })).toBe("1.234567")
    expect(formatUsdc(117_000_000n, { decimals: "exact" })).toBe("117.00")
    expect(formatUsdc(1_000_000_000_500_000n, { decimals: "exact" })).toBe("1,000,000,000.50")
    for (const reward of [1_000_000n, 5_000_000n, 1_230_000n, 99_990_000n]) {
      const { toMachine, fee } = splitReward(reward, 250)
      const sum = parseUsdc(formatUsdc(toMachine, { decimals: "exact" }))! + parseUsdc(formatUsdc(fee, { decimals: "exact" }))!
      expect(sum).toBe(reward)
    }
  })

  it("can drop decimals for whole aggregates", () => {
    expect(formatUsdc(48_210_000_000n, { decimals: 0 })).toBe("48,210")
  })
})

describe("parseUsdc", () => {
  it("reads what a person types into base units, never floats", () => {
    expect(parseUsdc("120")).toBe(120_000_000n)
    expect(parseUsdc("120.5")).toBe(120_500_000n)
    expect(parseUsdc("0.000001")).toBe(1n)
    expect(parseUsdc("1,250.00")).toBe(1_250_000_000n)
  })

  it("refuses junk and more than 6 decimals", () => {
    expect(parseUsdc("")).toBeNull()
    expect(parseUsdc("abc")).toBeNull()
    expect(parseUsdc("-1")).toBeNull()
    expect(parseUsdc("1.0000001")).toBeNull()
  })

  it("can hold a typed reward to cents, so what is shown is what is locked", () => {
    expect(parseUsdc("1.23", { maxDecimals: 2 })).toBe(1_230_000n)
    expect(parseUsdc("1.234567", { maxDecimals: 2 })).toBeNull()
    expect(parseUsdc("0.999999", { maxDecimals: 2 })).toBeNull()
  })
})

describe("shortAddress", () => {
  it("keeps 4 + 4 characters", () => {
    expect(shortAddress("7f3aKq9xPZ2mLwT4nB8vR1sYc91e")).toBe("7f3a…c91e")
    expect(shortAddress("abcd")).toBe("abcd")
  })
})
