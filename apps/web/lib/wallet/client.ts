"use client"
// The browser's wallet client (Wallet Standard via @solana/kit-plugin-wallet) and its RPC. Mainnet only in
// production (CLAUDE.md §0); locally the harness's validator, as `solana:localnet`.
import { createClient, createDefaultRpcTransport, createSolanaRpcFromTransport, type RpcTransport } from "@solana/kit"
import { walletWithoutSigner, type ClientWithWallet } from "@solana/kit-plugin-wallet"
import { BROWSER_RPC_URL } from "../rpc-url"
import { failover } from "./failover"

export const RPC_URL = BROWSER_RPC_URL
export const CHAIN = process.env.NEXT_PUBLIC_RPC_URL ? "solana:mainnet" : "solana:localnet"
export const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // TODO(verify) before M5

let client: ClientWithWallet | undefined
/** One wallet client per page (it remembers the last wallet and reconnects silently). */
export function walletClient(): ClientWithWallet {
  client ??= createClient().use(walletWithoutSigner({ chain: CHAIN, storageKey: "samite:wallet" }))
  return client
}

/**
 * Solana's public mainnet RPC: where the browser's requests go when its own key fails (refused, rate-limited, down).
 * Not Samite's server, so the job page's check stays independent of the API (§12). It is rate-limited itself, so it
 * is only the fallback. The CSP already allows it (lib/csp.ts).
 */
const PUBLIC_RPC_URL = "https://api.mainnet-beta.solana.com"

function transport(): RpcTransport {
  const own = createDefaultRpcTransport({ url: RPC_URL })
  if (CHAIN !== "solana:mainnet") return own
  return failover([own, createDefaultRpcTransport({ url: PUBLIC_RPC_URL })], {
    onFail: (i, e) =>
      console.warn(
        JSON.stringify({
          msg: i === 0 ? "browser rpc failed; using Solana's public RPC" : "public rpc failed",
          e: String(e),
        }),
      ),
  })
}

let rpc: ReturnType<typeof createSolanaRpcFromTransport<RpcTransport>> | undefined
/** The browser's own view of the chain (NEXT_PUBLIC_RPC_URL): the job page re-checks the API against it (§12). */
export const browserRpc = () => (rpc ??= createSolanaRpcFromTransport(transport()))
