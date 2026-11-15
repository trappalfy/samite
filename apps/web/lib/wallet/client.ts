"use client"
// The browser's wallet client (Wallet Standard via @solana/kit-plugin-wallet) and its RPC. Mainnet only in
// production (CLAUDE.md §0); locally the harness's validator, as `solana:localnet`.
import { createClient, createDefaultRpcTransport, createSolanaRpcFromTransport, type RpcTransport } from "@solana/kit"
import { walletWithoutSigner, type ClientWithWallet } from "@solana/kit-plugin-wallet"
import { BROWSER_RPC_URL, PUBLIC_RPC_URLS } from "../rpc-url"
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

function transport(): RpcTransport {
  const own = createDefaultRpcTransport({ url: RPC_URL })
  if (CHAIN !== "solana:mainnet") return own
  const all = [RPC_URL, ...PUBLIC_RPC_URLS]
  return failover(
    all.map((url) => createDefaultRpcTransport({ url })),
    {
      // the origin only: the browser key's URL carries its API key
      onFail: (i, e) =>
        console.warn(
          JSON.stringify({ msg: "browser rpc failed", rpc: i === 0 ? "own" : new URL(all[i]!).host, e: String(e) }),
        ),
    },
  )
}

let rpc: ReturnType<typeof createSolanaRpcFromTransport<RpcTransport>> | undefined
/** The browser's own view of the chain (NEXT_PUBLIC_RPC_URL): the job page re-checks the API against it (§12). */
export const browserRpc = () => (rpc ??= createSolanaRpcFromTransport(transport()))
