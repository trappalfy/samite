// When a time-out instruction is due (CLAUDE.md §4.3). These are the program's own comparisons; the keeper checks
// them against the chain's clock and the chain's account before sending, so it never pays for a transaction the
// program would refuse.
import { LIMITS } from "@samite/config/solana"

export type TimedJob = {
  status: "open" | "claimed" | "delivered"
  deadline: bigint
  reviewWindow: bigint
  claimWindow: bigint
  claimedAt: bigint
  deliveredAt: bigint
  deliveries: number
}

export type KeeperAction = "release" | "refund" | "expire"

const MIN_RESUBMIT = BigInt(LIMITS.minResubmitSeconds)

export function dueAction(j: TimedJob, now: bigint): KeeperAction | null {
  if (j.status === "delivered") return now > j.deliveredAt + j.reviewWindow ? "release" : null
  if (now > j.deadline) return "refund" // open or claimed; a refund beats an expired claim
  if (j.status === "claimed" && j.claimWindow > 0n) {
    const hold = j.deliveries > 0 && j.claimWindow < MIN_RESUBMIT ? MIN_RESUBMIT : j.claimWindow
    if (now > j.claimedAt + hold) return "expire"
  }
  return null
}
