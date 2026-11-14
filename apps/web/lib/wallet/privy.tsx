"use client"
// The Privy layer (the owner's choice, Nov 13): Privy's modal connects the person's own Solana wallet (Phantom,
// Solflare, Backpack, any Wallet Standard wallet). Wallets only: no email or social login and no Privy-made wallets,
// so Samite holds no emails and the keys stay in the person's wallet. Privy is only the connect step: the session
// is still Samite's own Sign-In With Solana (session.ts), and every transaction is checked in the page (verify.ts)
// and signed by the wallet. Loaded on the app's pages only, when NEXT_PUBLIC_PRIVY_APP_ID is set, and only once someone
// asks to connect (or connected before, to reconnect): browsing the board loads none of it (WalletLayer.tsx).
import { useEffect, useRef } from "react"
import { PrivyProvider, useConnectWallet } from "@privy-io/react-auth"
import {
  toSolanaWalletConnectors,
  useStandardWallets,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana"
import { CHAIN } from "./client"
import { remember, remembered } from "./remember"
import { setWallet, type ConnectedWallet } from "./store"
import "./privy.css"

const connectors = toSolanaWalletConnectors()

function toConnected(w: ConnectedStandardSolanaWallet): ConnectedWallet {
  const signIn = w.standardWallet.features["solana:signIn"]
  return {
    address: w.address,
    name: w.standardWallet.name,
    signTransaction: async (wire) =>
      (await w.signTransaction({ transaction: wire, chain: CHAIN as `${string}:${string}` })).signedTransaction,
    signMessage: async (message) => (await w.signMessage({ message })).signature,
    signIn: signIn
      ? async (input) => {
          const [out] = await signIn.signIn({ ...input, address: w.address })
          if (!out) throw new Error("The wallet didn't sign in.")
          return { address: out.account.address, signedMessage: out.signedMessage, signature: out.signature }
        }
      : undefined,
  }
}

/** How long Privy may take to become ready once its code has loaded, before the app's own dialog takes over. */
const READY_WITHIN_MS = 10_000

function Bridge({ onFail, openOnReady }: { onFail: () => void; openOnReady: boolean }) {
  const { ready, wallets } = useWallets()
  useEffect(() => {
    if (ready) return
    const t = setTimeout(onFail, READY_WITHIN_MS)
    return () => clearTimeout(t)
  }, [ready, onFail])
  const { connectWallet } = useConnectWallet()
  const { wallets: installed } = useStandardWallets()
  // the wallet last connected here if Privy still has it, else the first one it has
  const last = remembered()
  const w = wallets.find((x) => x.address === last?.address) ?? wallets[0] ?? null

  // Reconnect the wallet connected here before, silently, as the built-in layer does: Privy auto-connects only some
  // wallets by itself (Phantom only after a Privy login). A wallet that already trusts this site answers without a
  // prompt; one that doesn't stays disconnected until "Connect wallet". Privy picks the new account up from the
  // wallet's change event.
  const tried = useRef(false)
  const lastName = last?.name ?? null
  useEffect(() => {
    if (!ready || w || !lastName || tried.current) return
    const sw = installed.find((x) => x.name === lastName)
    if (!sw) return
    tried.current = true
    void sw.features["standard:connect"]?.connect({ silent: true }).catch(() => undefined)
  }, [ready, w, lastName, installed])

  const opened = useRef(false)

  useEffect(() => {
    // until Privy is ready, the store keeps what WalletLayer set (the chip stays usable)
    if (!ready) return
    // remembered from what Privy reports, so the next visit loads Privy at once to reconnect (Privy's connectWallet
    // onSuccess callback doesn't fire for Solana wallets, checked with 3.51.0)
    if (w) remember({ address: w.address, name: w.standardWallet.name })
    const open = () => connectWallet({ walletChainType: "solana-only", description: "" })
    setWallet({
      layer: "privy",
      ready: true,
      connected: w ? toConnected(w) : null,
      choices: null,
      open,
      disconnect: async () => {
        remember(null)
        await w?.disconnect()
      },
    })
    // loaded by a click on "Connect wallet": open the modal it asked for, once
    if (openOnReady && !opened.current && !w) {
      opened.current = true
      open()
    }
  }, [ready, w, connectWallet, openOnReady])
  return null
}

export default function PrivyWallet({
  appId,
  onFail,
  openOnReady,
}: {
  appId: string
  onFail: () => void
  openOnReady: boolean
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: "#0A0A09",
          accentColor: "#F2EFE8",
          logo: "/brand/samite-mark-cream.svg",
          landingHeader: "Connect a wallet",
          walletChainType: "solana-only",
          walletList: ["detected_solana_wallets", "phantom", "solflare", "backpack"],
        },
        externalWallets: { solana: { connectors } },
        embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
      }}
    >
      <Bridge onFail={onFail} openOnReady={openOnReady} />
    </PrivyProvider>
  )
}
