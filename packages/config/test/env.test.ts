import { describe, expect, it } from "vitest"
import { parsePublicEnv, parseServerEnv } from "../src/env"

describe("parsePublicEnv", () => {
  it("treats an empty token CA as no token", () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_TOKEN_CA: "" }).tokenCa).toBeUndefined()
    expect(parsePublicEnv({}).tokenCa).toBeUndefined()
  })

  it("rejects a malformed site URL", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SITE_URL: "not a url" })).toThrow()
  })

  it("keeps a valid site URL", () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_SITE_URL: "https://samite.fun" }).siteUrl).toBe("https://samite.fun")
  })
})

describe("parseServerEnv", () => {
  it("leaves the keeper off unless it is exactly 'true'", () => {
    expect(parseServerEnv({}).keeperEnabled).toBe(false)
    expect(parseServerEnv({ KEEPER_ENABLED: "" }).keeperEnabled).toBe(false)
    expect(parseServerEnv({ KEEPER_ENABLED: "yes" }).keeperEnabled).toBe(false)
    expect(parseServerEnv({ KEEPER_ENABLED: "true" }).keeperEnabled).toBe(true)
  })

  it("defaults the USDC mint to the mainnet address", () => {
    expect(parseServerEnv({}).usdcMint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
  })
})
