// Solana constants (CLAUDE.md §3, §4.4, §15). Re-verify each against its source before M5.

/** USDC mint on mainnet, classic SPL Token, 6 decimals. Source: Circle, checked Nov 12, 2026. */
// Read from mainnet on Nov 12, 2026: a classic SPL Token mint (owner Tokenkeg…), 6 decimals, initialized, with a
// freeze authority (Circle can freeze USDC accounts). TODO(verify): the owner checks the address on Circle's
// "USDC contract addresses" page before M5.
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
/** Mainnet's genesis hash (read Nov 12, 2026): the mainnet scripts refuse any other cluster. */
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
export const USDC_DECIMALS = 6
export const USDC_BASE = 1_000_000n

const HOUR = 3600

export const LIMITS = {
  feeBps: 250, // 2.5% at launch (owner decision)
  maxFeeBps: 500, // compile-time cap in the program
  minRewardBaseUnits: 1_000_000n, // 1 USDC (owner to confirm)
  warnRewardBaseUnits: 10_000_000_000n, // the web app warns above 10,000 USDC
  minDeadlineSeconds: 1 * HOUR,
  maxDeadlineSeconds: 90 * 24 * HOUR,
  minReviewWindowSeconds: 1 * HOUR,
  maxReviewWindowSeconds: 7 * 24 * HOUR,
  defaultReviewWindowSeconds: 48 * HOUR,
  minClaimWindowSeconds: 1 * HOUR,
  maxDeliveries: 3,
  minResubmitSeconds: 24 * HOUR,
  maxAllowlist: 10,
} as const
