import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { spendGuard } from "../src/guards"

const dir = () => mkdtempSync(join(tmpdir(), "samite-mcp-"))
const USDC = 1_000_000n

describe("spendGuard (§6.3)", () => {
  it("is off by default: no posting at all", () => {
    const g = spendGuard({ maxPost: 0n, dailySpend: 0n, dir: dir(), address: "A" })
    expect(g.enabled).toBe(false)
    expect(() => g.check(1n)).toThrow(/off/)
  })

  it("refuses one job above the per-job cap, and the day's total above the daily cap", () => {
    const g = spendGuard({ maxPost: 10n * USDC, dailySpend: 15n * USDC, dir: dir(), address: "A" })
    expect(() => g.check(11n * USDC)).toThrow(/SAMITE_MAX_POST_USDC allows 10.00/)
    g.check(10n * USDC)
    g.record(10n * USDC)
    expect(() => g.check(6n * USDC)).toThrow(/reach 16.00 USDC/)
    g.check(5n * USDC)
  })

  it("keeps the day's total across restarts, and starts again the next UTC day", () => {
    const d = dir()
    let t = Date.parse("2026-11-12T23:00:00Z")
    const a = spendGuard({ maxPost: 10n * USDC, dailySpend: 10n * USDC, dir: d, address: "A", now: () => t })
    a.record(10n * USDC)
    const b = spendGuard({ maxPost: 10n * USDC, dailySpend: 10n * USDC, dir: d, address: "A", now: () => t })
    expect(() => b.check(1n)).toThrow()
    t = Date.parse("2026-11-13T00:00:01Z")
    expect(() => b.check(10n * USDC)).not.toThrow()
  })
})
