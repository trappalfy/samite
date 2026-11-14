// Spending guards (CLAUDE.md §6.3): posting is off unless SAMITE_MAX_POST_USDC > 0; one job may lock at most that;
// all posting together at most SAMITE_DAILY_SPEND_USDC per UTC day (default 0 = no posting). The day's total is kept in
// a small file per address, so restarting the server doesn't reset it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { formatUsdc } from "@samite/config/money"

export type Limits = { maxPost: bigint; dailySpend: bigint }

export class GuardError extends Error {}

export function spendGuard(o: Limits & { dir: string; address: string; now?: () => number }) {
  const file = join(o.dir, `spend-${o.address}.json`)
  const day = () => new Date((o.now ?? Date.now)()).toISOString().slice(0, 10)
  const read = (): { day: string; spent: string } => {
    try {
      return JSON.parse(readFileSync(file, "utf8"))
    } catch {
      return { day: day(), spent: "0" }
    }
  }
  const spentToday = () => {
    const r = read()
    return r.day === day() ? BigInt(r.spent) : 0n
  }
  return {
    enabled: o.maxPost > 0n && o.dailySpend > 0n,
    spentToday,
    /** Throws a plain-English GuardError if `amount` may not be spent now. */
    check(amount: bigint) {
      if (o.maxPost <= 0n || o.dailySpend <= 0n)
        throw new GuardError(
          "Posting and reviewing are off: set SAMITE_MAX_POST_USDC and SAMITE_DAILY_SPEND_USDC above 0 to allow them.",
        )
      if (amount > o.maxPost)
        throw new GuardError(
          `This locks ${formatUsdc(amount)} USDC; SAMITE_MAX_POST_USDC allows ${formatUsdc(o.maxPost)}.`,
        )
      if (spentToday() + amount > o.dailySpend)
        throw new GuardError(
          `Today's posting would reach ${formatUsdc(spentToday() + amount)} USDC; SAMITE_DAILY_SPEND_USDC allows ${formatUsdc(o.dailySpend)} a day.`,
        )
    },
    record(amount: bigint) {
      mkdirSync(o.dir, { recursive: true })
      writeFileSync(file, JSON.stringify({ day: day(), spent: (spentToday() + amount).toString() }))
    },
  }
}
