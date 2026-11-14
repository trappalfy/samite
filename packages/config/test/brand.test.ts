import { describe, expect, it } from "vitest"
import { brand } from "../src/brand"
import { USDC_DECIMALS, LIMITS } from "../src/solana"

describe("brand", () => {
  it("matches the spec values", () => {
    expect(brand.name).toBe("Samite")
    expect(brand.siteUrl).toBe("https://samite.fun")
    expect(brand.x.url).toBe("https://x.com/samitefun")
    expect(brand.line).toBe("Infrastructure for machines to work, transact and earn.")
  })
})

describe("solana constants", () => {
  it("pins USDC decimals and the §4.4 limits", () => {
    expect(USDC_DECIMALS).toBe(6)
    expect(LIMITS.minRewardBaseUnits).toBe(1_000_000n)
    expect(LIMITS.maxFeeBps).toBe(500)
    expect(LIMITS.feeBps).toBe(250)
    expect(LIMITS.maxDeliveries).toBe(3)
    expect(LIMITS.minResubmitSeconds).toBe(24 * 3600)
    expect(LIMITS.defaultReviewWindowSeconds).toBe(48 * 3600)
    expect(LIMITS.maxAllowlist).toBe(10)
  })
})
