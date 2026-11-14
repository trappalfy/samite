import { describe, expect, it } from "vitest"
import { isClosed, isIndexable, isProduction, isPublic } from "../lib/env"

describe("isProduction", () => {
  it("is true only on Vercel's production deployment", () => {
    expect(isProduction({ VERCEL_ENV: "production" })).toBe(true)
    expect(isProduction({ VERCEL_ENV: "preview" })).toBe(false)
    expect(isProduction({ VERCEL_ENV: "development" })).toBe(false)
    expect(isProduction({})).toBe(false)
  })

  it("can be forced for local checks of the gate", () => {
    expect(isProduction({ SAMITE_FORCE_PRODUCTION: "1" })).toBe(true)
  })
})

// samite.fun is closed until the owner launches (SAMITE_PUBLIC=1); only then may it be indexed (lib/gate.ts)
describe("launch", () => {
  it("closes production until SAMITE_PUBLIC=1, and indexes nothing but the launched production site", () => {
    expect(isClosed({ VERCEL_ENV: "production" })).toBe(true)
    expect(isClosed({ VERCEL_ENV: "production", SAMITE_PUBLIC: "1" })).toBe(false)
    expect(isClosed({ VERCEL_ENV: "preview" })).toBe(false)
    expect(isPublic({ SAMITE_PUBLIC: "true" })).toBe(false) // exactly "1"
    expect(isIndexable({ VERCEL_ENV: "production", SAMITE_PUBLIC: "1" })).toBe(true)
    expect(isIndexable({ VERCEL_ENV: "production" })).toBe(false)
    expect(isIndexable({ VERCEL_ENV: "preview", SAMITE_PUBLIC: "1" })).toBe(false)
    expect(isIndexable({})).toBe(false)
  })
})
