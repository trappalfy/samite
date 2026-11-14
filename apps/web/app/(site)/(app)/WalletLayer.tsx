"use client"
// Which layer connects wallets (lib/wallet/store.ts): Privy's modal where NEXT_PUBLIC_PRIVY_APP_ID is set (the site),
// the app's own Wallet Standard dialog without it (local runs on solana:localnet, the end-to-end tests).
// Privy loads only when it is needed: on a click on "Connect wallet", or at once for a browser that connected through
// it before (to reconnect). Browsing the board loads none of its code and sets none of its cookies.
// If Privy fails (an error, or not ready in time: blocked, down, misconfigured), the app's own dialog takes over, so
// a wallet can always connect.
import { Component, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { remembered } from "@/lib/wallet/remember"
import { StandardWallet } from "@/lib/wallet/standard"
import { setWallet } from "@/lib/wallet/store"

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID
const PrivyWallet = dynamic(() => import("@/lib/wallet/privy"), { ssr: false })

class Fallback extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(e: unknown) {
    console.error(JSON.stringify({ msg: "privy failed; using the built-in wallet dialog", error: String(e) }))
    this.props.onError()
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

const noSubscribe = () => () => {}

export function WalletLayer() {
  // a wallet connected through Privy before, in this browser: load Privy at once to reconnect it
  const reconnect = useSyncExternalStore(
    noSubscribe,
    () => remembered() !== null,
    () => false,
  )
  const [clicked, setClicked] = useState(false)
  const [failed, setFailed] = useState(false)
  const fail = useCallback(() => {
    console.error(JSON.stringify({ msg: "privy not ready; using the built-in wallet dialog" }))
    setFailed(true)
  }, [])
  const load = reconnect || clicked

  useEffect(() => {
    if (!PRIVY_APP_ID || load || failed) return
    // nothing to reconnect: a connect button that loads Privy when pressed
    setWallet({
      layer: "privy",
      ready: true,
      connected: null,
      choices: null,
      open: () => setClicked(true),
      disconnect: async () => {},
    })
  }, [load, failed])

  if (!PRIVY_APP_ID || failed) return <StandardWallet />
  if (!load) return null
  return (
    <Fallback onError={() => setFailed(true)}>
      <PrivyWallet appId={PRIVY_APP_ID} onFail={fail} openOnReady={clicked} />
    </Fallback>
  )
}
