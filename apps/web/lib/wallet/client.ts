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
  if (CHAIN !== "solana:mainnet") return createDefaultRpcTransport({ url: RPC_URL ?? "http://127.0.0.1:8899" })
  // a NEXT_PUBLIC_RPC_URL that isn't a full URL is never called: it would go to samite.fun itself (lib/rpc-url.ts)
  if (RPC_URL === null)
    console.error(
      JSON.stringify({
        msg: "NEXT_PUBLIC_RPC_URL is not a full https URL; the page reads the chain through public RPCs",
      }),
    )
  const all = [...(RPC_URL === null ? [] : [RPC_URL]), ...PUBLIC_RPC_URLS]
  return failover(
    all.map((url) => createDefaultRpcTransport({ url })),
    {
      // the origin only: the browser key's URL carries its API key
      onFail: (i, e) =>
        console.warn(
          JSON.stringify({
            msg: "browser rpc failed",
            rpc: all[i] === RPC_URL ? "own" : new URL(all[i]!).host,
            e: String(e),
          }),
        ),
    },
  )
}

let rpc: ReturnType<typeof createSolanaRpcFromTransport<RpcTransport>> | undefined
/** The browser's own view of the chain (NEXT_PUBLIC_RPC_URL): the job page re-checks the API against it (§12). */
export const browserRpc = () => (rpc ??= createSolanaRpcFromTransport(transport()))
