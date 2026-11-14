"use client"
// The connected wallet, whichever layer connects it: Privy's modal on the site (NEXT_PUBLIC_PRIVY_APP_ID set), or the
// app's own Wallet Standard dialog without it (local runs and tests, where the chain is `solana:localnet`, which
// Privy doesn't know). Pages read this store only; each layer writes into it (privy.tsx, standard.tsx).
import { useSyncExternalStore } from "react"

/** What the app needs from a wallet. Transactions go in and out as wire bytes; the key never leaves the wallet. */
export type ConnectedWallet = {
  address: string
  name: string
  /** Signs the transaction; the app relays it (/tx/send). */
  signTransaction?: (wire: Uint8Array) => Promise<Uint8Array>
  /** For wallets that only sign and send themselves: returns the signature. */
  signAndSendTransaction?: (wire: Uint8Array) => Promise<Uint8Array>
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
  /** Wallet Standard `solana:signIn`, where the wallet has it (§6.1). */
  signIn?: (input: Record<string, string>) => Promise<{
    address: string
    signedMessage: Uint8Array
    signature: Uint8Array
  }>
}

/** A wallet found in this browser, for the app's own dialog. */
export type WalletChoice = { name: string; icon?: string; connect: () => Promise<void> }

export type WalletState = {
  layer: "privy" | "standard" | null
  ready: boolean
  connected: ConnectedWallet | null
  /** Standard layer: the wallets to list in the app's dialog. Privy shows its own list. */
  choices: WalletChoice[] | null
  /** Privy layer: opens Privy's connect modal. */
  open: (() => void) | null
  disconnect: () => Promise<void>
}

const INITIAL: WalletState = {
  layer: null,
  ready: false,
  connected: null,
  choices: null,
  open: null,
  disconnect: async () => {},
}
let state = INITIAL
const listeners = new Set<() => void>()

export function setWallet(next: Partial<WalletState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

/** The state now, for code that runs after an await (it may have changed since the render). */
export const getWallet = () => state

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The wallet state; on the server and while hydrating, not ready (the wallet exists only in the browser). */
export function useWallet(): WalletState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  )
}

/** The connected wallet, or an error a page can show. */
export function requireWallet(): ConnectedWallet {
  const w = state.connected
  if (!w) throw new Error("Connect a wallet first (top right).")
  return w
}
