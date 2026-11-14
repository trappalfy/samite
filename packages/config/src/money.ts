import { LIMITS, USDC_DECIMALS } from "./solana"

/** The payout split (CLAUDE.md §4.5): fee = floor(reward · bps / 10 000), the machine gets the rest. */
export function splitReward(reward: bigint, feeBps: number): { toMachine: bigint; fee: bigint } {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > LIMITS.maxFeeBps) throw new RangeError(`fee ${feeBps} bps`)
  const fee = (reward * BigInt(feeBps)) / 10_000n
  return { toMachine: reward - fee, fee }
}

const SCALE = 10n ** BigInt(USDC_DECIMALS)
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",")

/**
 * Base units → "1,234.56". Display only; never parse this back.
 * By default it never rounds: at least 2 decimals, up to 6 (`117.00`, `0.975`, `4.040001`), so every amount on a
 * screen is the chain's amount (a machine's 0.975 USDC showed as 0.98 until Nov 15). `decimals: 0 | 2` rounds half up,
 * for totals that say they are rounded. `decimals: "exact"` is the default, spelled out.
 */
export function formatUsdc(amount: bigint, opts: { decimals?: 0 | 2 | "exact" } = {}): string {
  const neg = amount < 0n
  const abs = neg ? -amount : amount
  let s: string
  if (opts.decimals === undefined || opts.decimals === "exact") {
    const frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "").padEnd(2, "0")
    s = `${group((abs / SCALE).toString())}.${frac}`
  } else {
    const decimals = opts.decimals
    const unit = 10n ** BigInt(USDC_DECIMALS - decimals)
    const rounded = (abs + unit / 2n) / unit // in units of 10^-decimals USDC
    const whole = rounded / 10n ** BigInt(decimals)
    const frac = rounded % 10n ** BigInt(decimals)
    s = group(whole.toString()) + (decimals ? "." + frac.toString().padStart(decimals, "0") : "")
  }
  return neg ? "-" + s : s
}

/**
 * "1,250.5" → base units; null for anything that isn't a non-negative amount with ≤ 6 decimals
 * (≤ `maxDecimals` when given: the post form holds rewards to cents, so the amount shown is the amount locked).
 */
export function parseUsdc(input: string, opts: { maxDecimals?: number } = {}): bigint | null {
  const s = input.trim().replace(/,/g, "")
  const m = s.match(/^(\d+)(?:\.(\d+))?$/)
  if (!m) return null
  const frac = m[2] ?? ""
  if (frac.length > Math.min(opts.maxDecimals ?? USDC_DECIMALS, USDC_DECIMALS)) return null
  return BigInt(m[1]!) * SCALE + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0")
}

/** "7f3a…c91e" (4 + 4, CLAUDE.md §11.11). */
export function shortAddress(address: string): string {
  return address.length <= 9 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`
}
