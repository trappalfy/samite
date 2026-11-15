/** The browser's RPC: NEXT_PUBLIC_RPC_URL on samite.fun; locally the harness's validator. The CSP allows its origin. */
export const BROWSER_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899"

/**
 * Where the browser's chain check goes when NEXT_PUBLIC_RPC_URL fails (refused, rate-limited, down), in order: public
 * mainnet RPCs, not Samite's server, so the check stays independent of the API (§12). PublicNode first: Solana's own
 * answered the owner's browser with 403 for hours (Nov 15). Both send CORS headers for any site (checked Nov 15).
 * The CSP allows each (lib/csp.ts).
 */
export const PUBLIC_RPC_URLS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"] as const
