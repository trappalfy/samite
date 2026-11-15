// Every /tx/* transaction is simulated before it is handed to a wallet (no signature needed: sigVerify false). Phantom
// blocks a transaction it can't predict, and one that would fail on-chain is the usual cause ("This dApp could be
// malicious", docs.phantom.com: Domain and transaction warnings, which asks dApps to simulate first). A wallet short
// of SOL for the job's rent is the common case. So a failure here becomes a plain sentence about what is missing,
// and no wallet is asked to sign something that can't work.
import { ApiError } from "./errors"
import { formatUsdc } from "@samite/config/money"

export type Simulated = { err: unknown; logs: readonly string[] | null }
/**
 * What the transaction needs from the fee payer: rent for the accounts it opens, the minimum a wallet must keep after it
 * (`reserve`, a 0-byte account's rent: a wallet can't be left with less unless it is emptied), network fees with a margin
 * for the priority fee a wallet adds (`fees`), and the USDC it locks (0 if none).
 */
export type Needs = { rent: bigint; rentComesBack: boolean; usdc: bigint; reserve: bigint; fees: bigint }

/** A wallet's own priority fee: Phantom added 75,000 lamports to each of the owner's mainnet transactions (Nov 14–15). */
export const PRIORITY_FEE_MARGIN = 100_000n
/** What the fee payer holds; `usdc` is null when the wallet has no USDC account at all. */
export type Holds = { lamports: bigint; usdc: bigint | null }

const SOL_ERRORS = new Set(["InsufficientFundsForFee", "InsufficientFundsForRent", "AccountNotFound"])

/** Lamports as SOL, exact, without trailing zeros: 5463116n → "0.005463116". */
export function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n
  const frac = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "")
  return frac ? `${whole}.${frac}` : `${whole}`
}

const errName = (err: unknown) =>
  typeof err === "string" ? err : err && typeof err === "object" ? (Object.keys(err)[0] ?? "") : ""

/** The Anchor error message a failed simulation logged, if any ("Error Message: The deadline has passed."). */
export function anchorMessage(logs: readonly string[] | null): string | null {
  for (const l of [...(logs ?? [])].reverse()) {
    const m = l.match(/Error Message: (.+?)\.?$/)
    if (m) return m[1]!
  }
  return null
}

/** Turns a failed simulation into the error the caller sees. */
export function explainFailure(sim: Simulated, need: Needs, have: Holds): ApiError {
  const logs = sim.logs ?? []
  const nothing = "Nothing was signed."
  const lamports = need.rent + need.reserve + need.fees
  const solShort =
    have.lamports < lamports || SOL_ERRORS.has(errName(sim.err)) || logs.some((l) => /insufficient lamports/i.test(l))
  if (solShort) {
    const parts = [
      need.rent > 0n &&
        `${formatSol(need.rent)} account rent${need.rentComesBack ? ", which comes back when the job closes" : ""}`,
      need.reserve > 0n && `${formatSol(need.reserve)} that Solana requires every wallet to keep`,
      `about ${formatSol(need.fees)} for network fees`,
    ].filter(Boolean) as string[]
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}` : parts[0]
    return new ApiError(
      "insufficient_funds",
      `Your wallet has ${formatSol(have.lamports)} SOL; this needs about ${formatSol(lamports)} SOL: ${list}. Add a little SOL and try again. ${nothing}`,
      { asset: "SOL", need_lamports: lamports.toString(), have_lamports: have.lamports.toString() },
    )
  }
  const usdcShort =
    need.usdc > (have.usdc ?? 0n) ||
    logs.some((l) => /Error: insufficient funds/i.test(l)) ||
    logs.some((l) => /AccountNotInitialized/.test(l) && /usdc/i.test(l))
  if (usdcShort)
    return new ApiError(
      "insufficient_funds",
      `${have.usdc === null ? "Your wallet has no USDC yet" : `Your wallet has ${formatUsdc(have.usdc, { decimals: "exact" })} USDC`}; this locks ${formatUsdc(need.usdc, { decimals: "exact" })} USDC. Add USDC and try again. ${nothing}`,
      { asset: "USDC", need_usdc: need.usdc.toString(), have_usdc: (have.usdc ?? 0n).toString() },
    )
  const why = anchorMessage(logs)
  return new ApiError(
    "tx_would_fail",
    `This transaction would fail on-chain${why ? `: ${why}` : ` (${errName(sim.err) || "simulation failed"})`}. ${nothing}`,
    { err: JSON.parse(JSON.stringify(sim.err ?? null, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) },
  )
}
