import { describe, expect, it } from "vitest"
import { ago, duration, feedItem, nextLine, pendingTimeout, type JobJson, landingLive } from "../lib/view"

describe("durations and times (§11.11)", () => {
  it("reads like the prototype", () => {
    expect(duration(41 * 3600 + 12 * 60 + 30)).toBe("41h 12m")
    expect(duration(2 * 86_400 + 22 * 3600)).toBe("2d 22h")
    expect(duration(12 * 60)).toBe("12m")
    expect(ago(12)).toBe("12s")
    expect(ago(65)).toBe("1m")
    expect(ago(3 * 3600 + 5)).toBe("3h")
  })
})

// Review Focus 5: countdowns agree with the program's comparisons at the exact second.
const job = (o: Partial<JobJson>): JobJson =>
  ({ status: "delivered", deadline: 2_000, review_window: 100, delivered_at: 1_000, ...o }) as JobJson
describe("pendingTimeout", () => {
  it("auto-release becomes possible one second after the review window ends, as release_after_review requires", () => {
    expect(pendingTimeout(job({}), 1_100)).toMatchObject({ kind: "auto-release", left: 1 })
    expect(pendingTimeout(job({}), 1_101)).toMatchObject({ kind: "auto-release", left: 0 })
  })
  it("refund becomes possible one second after the deadline, and never while delivered", () => {
    expect(pendingTimeout(job({ status: "open" }), 2_000)).toMatchObject({ kind: "refund", left: 1 })
    expect(pendingTimeout(job({ status: "claimed" }), 2_001)).toMatchObject({ kind: "refund", left: 0 })
    expect(pendingTimeout(job({ status: "delivered" }), 5_000)!.kind).toBe("auto-release")
    expect(pendingTimeout(job({ status: "paid" }), 5_000)).toBeNull()
  })
  it("says what happens next to each side", () => {
    expect(nextLine(job({}), "poster", 1_000 + 100 - 3_600 * 41)).toMatch(/^your review, or auto-release in/)
    expect(nextLine(job({ status: "open" }), "poster", 0)).toBe("refund to you if nobody delivers in 33m")
  })
})

describe("feed lines", () => {
  it("say who got what", () => {
    expect(
      feedItem(
        { id: 1, job: "0412", kind: "paid", actor: "7f3aKq9xPZ2mLwT4nB8vR1sYc91e", amount: "117000000", at: 88 },
        100,
      ),
    ).toEqual({ kind: "paid", text: "0412 paid 117.00 → 7f3a…c91e", at: "12s" })
  })
})

describe("landingLive (§11.10: real data where it exists, else the labelled example)", () => {
  const hours = (n: number) => Array.from({ length: 24 }, (_, i) => (i === 23 ? n : 0))
  const ev = (id: number, kind: string, amount: string | null = "78000000") => ({
    id,
    job: String(id).padStart(4, "0"),
    kind,
    actor: "9B6oPeqPKzRQXK2W2fJEUgRDxFC4PYrRthseKW8BeJde",
    amount,
    at: 1_700_000_000 + id,
  })

  it("keeps everything as the example when the API can't be reached or nothing settled today", () => {
    expect(landingLive(null, null)).toEqual({ chart: null, escrow: null, meterOn: null, settlements: null })
    expect(landingLive({ usdc_in_escrow: "5000000", paid_24h: "0", jobs_per_hour: hours(0) }, [])).toMatchObject({
      chart: null,
      escrow: null,
    })
  })

  it("goes live for the chart and the meter once anything settled in 24 h", () => {
    const l = landingLive({ usdc_in_escrow: "48210000000", paid_24h: "78000000", jobs_per_hour: hours(2) }, [])
    expect(l.chart).toEqual(hours(2))
    expect(l.escrow).toBe("48,210 USDC")
    expect(l.meterOn).toBe(22) // log scale to 1,000,000 USDC: 48,210 lights 22 of 28
    expect(landingLive({ usdc_in_escrow: "0", paid_24h: "1", jobs_per_hour: hours(1) }, []).meterOn).toBe(0)
  })

  it("shows the four latest real settlements, newest first, only once there are four", () => {
    const three = [ev(1, "paid"), ev(2, "posted"), ev(3, "refunded", "5000000"), ev(4, "auto_released")]
    expect(landingLive(null, three).settlements).toBeNull()
    const s = landingLive(null, [...three, ev(5, "claimed", null), ev(6, "paid", "117000000")]).settlements
    expect(s).toEqual([
      { k: "Job 0006 · paid", v: "117.00 USDC → 9B6o…eJde" },
      { k: "Job 0004 · auto-released", v: "78.00 USDC → 9B6o…eJde" },
      { k: "Job 0003 · refunded", v: "5.00 USDC → poster" },
      { k: "Job 0001 · paid", v: "78.00 USDC → 9B6o…eJde" },
    ])
  })
})
