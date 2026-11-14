import { describe, expect, it } from "vitest"
import { dueAction, type TimedJob } from "../src/keeper/rules"

// The keeper's rule must match the program's comparisons exactly (§4.3, DECISIONS "Time boundaries"):
// release `now > delivered_at + review_window`; refund `now > deadline` (never while Delivered);
// expire `now > claimed_at + hold`, hold = claim_window, or max(claim_window, 24 h) once there was a delivery.
const T = 1_800_000_000n
const base: TimedJob = {
  status: "open",
  deadline: T + 100_000n,
  reviewWindow: 3_600n,
  claimWindow: 0n,
  claimedAt: 0n,
  deliveredAt: 0n,
  deliveries: 0,
}

describe("dueAction", () => {
  it("releases one second after the review window, not at its last second", () => {
    const j: TimedJob = { ...base, status: "delivered", deliveredAt: T, deliveries: 1 }
    expect(dueAction(j, T + 3_600n)).toBeNull()
    expect(dueAction(j, T + 3_601n)).toBe("release")
  })

  it("never refunds a delivered job, even past the deadline (that protects the machine)", () => {
    const j: TimedJob = { ...base, status: "delivered", deliveredAt: T, deliveries: 1, deadline: T + 10n }
    expect(dueAction(j, T + 20n)).toBeNull()
    expect(dueAction(j, T + 3_601n)).toBe("release")
  })

  it("refunds an open or claimed job one second after the deadline", () => {
    for (const status of ["open", "claimed"] as const) {
      const j: TimedJob = { ...base, status, claimedAt: status === "claimed" ? T : 0n }
      expect(dueAction(j, base.deadline)).toBeNull()
      expect(dueAction(j, base.deadline + 1n)).toBe("refund")
    }
  })

  it("expires a stale claim one second after the claim window, and only with a window", () => {
    const j: TimedJob = { ...base, status: "claimed", claimWindow: 3_600n, claimedAt: T }
    expect(dueAction(j, T + 3_600n)).toBeNull()
    expect(dueAction(j, T + 3_601n)).toBe("expire")
    expect(dueAction({ ...j, claimWindow: 0n }, T + 99_999n)).toBeNull()
  })

  it("holds a claim at least 24 h after a rejection", () => {
    const j: TimedJob = {
      ...base,
      status: "claimed",
      claimWindow: 3_600n,
      claimedAt: T,
      deliveries: 1,
      deadline: T + 200_000n,
    }
    expect(dueAction(j, T + 3_601n)).toBeNull()
    expect(dueAction(j, T + 86_400n)).toBeNull()
    expect(dueAction(j, T + 86_401n)).toBe("expire")
  })

  it("prefers the refund when a claim is both stale and past the deadline: the poster gets the money back", () => {
    const j: TimedJob = { ...base, status: "claimed", claimWindow: 3_600n, claimedAt: T, deadline: T + 7_200n }
    expect(dueAction(j, T + 7_201n)).toBe("refund")
  })
})
