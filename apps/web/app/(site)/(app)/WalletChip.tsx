"use client"
// The wallet chip and its dialogs (§11.7, §11.12): square indicator + short address + USDC balance. Connecting opens
// Privy's modal where Privy is configured (lib/wallet/privy.tsx), else the app's own square, hairline dialog listing
// the Wallet Standard wallets in the browser (lib/wallet/standard.tsx). In example mode, the example wallet.
import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { address as toAddress } from "@solana/kit"
import { formatUsdc, shortAddress } from "@samite/config/money"
import { appClass as s, Button } from "@samite/ui/app"
import { EXAMPLE_WALLET } from "@/lib/examples"
import { browserRpc, USDC_MINT } from "@/lib/wallet/client"
import { signOut } from "@/lib/wallet/session"
import { useWallet } from "@/lib/wallet/store"

// The chip has room for two decimals, and it never shows more than the wallet holds: cut, not rounded (0.975 → 0.97).
const cents = (v: bigint) => v - (v % 10_000n)

function useUsdc(owner: string | undefined) {
  const [usdc, setUsdc] = useState<bigint | null>(null)
  useEffect(() => {
    if (!owner) return
    let live = true
    browserRpc()
      .getTokenAccountsByOwner(toAddress(owner), { mint: toAddress(USDC_MINT) }, { encoding: "jsonParsed" })
      .send()
      .then((r) => {
        const total = r.value.reduce(
          (n, a) =>
            n +
            BigInt(
              (a.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount
                .amount,
            ),
          0n,
        )
        if (live) setUsdc(total)
      })
      .catch(() => live && setUsdc(null))
    return () => {
      live = false
    }
  }, [owner])
  return owner ? usdc : null
}

export function WalletChip({ example: exampleDefault = false }: { example?: boolean }) {
  const example = useSearchParams().has("example") || exampleDefault
  if (example)
    return (
      <button className={s.wallet} type="button" aria-label={`Example wallet ${EXAMPLE_WALLET.address}`}>
        <i aria-hidden="true" />
        {EXAMPLE_WALLET.address} <span className={s.sol}>· {formatUsdc(EXAMPLE_WALLET.usdc)} USDC</span>
      </button>
    )
  return <LiveWallet />
}

function LiveWallet() {
  const { ready, connected, choices, open, disconnect } = useWallet()
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const usdc = useUsdc(connected?.address)

  // until the wallet layer has loaded in the browser (the server can't know the wallet), a placeholder
  if (!ready) return <span className={s.wallet} aria-hidden="true" style={{ visibility: "hidden" }} />

  if (connected)
    return (
      <>
        <button
          className={s.wallet}
          type="button"
          onClick={() => dialog.current?.showModal()}
          aria-label={`Wallet ${connected.address}`}
        >
          <i aria-hidden="true" />
          {shortAddress(connected.address)}
          {usdc !== null && <span className={s.sol}>· {formatUsdc(cents(usdc))} USDC</span>}
        </button>
        <dialog ref={dialog} className={s.dialog} aria-labelledby="wallet-h">
          <h2 id="wallet-h">{connected.name}</h2>
          <p className={s.mono} style={{ wordBreak: "break-all" }}>
            {connected.address}
          </p>
          <div className={s.dialogActions}>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut().catch(() => undefined)
                await disconnect()
                dialog.current?.close()
              }}
            >
              Disconnect
            </Button>
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Close
            </Button>
          </div>
        </dialog>
      </>
    )

  return (
    <>
      <button className={s.wallet} type="button" onClick={() => (open ? open() : dialog.current?.showModal())}>
        <i aria-hidden="true" style={{ background: "transparent", border: "1.5px solid var(--cream)" }} />
        Connect wallet
      </button>
      {choices && (
        <dialog ref={dialog} className={s.dialog} aria-labelledby="connect-h" onClose={() => setError("")}>
          <h2 id="connect-h">Connect a wallet</h2>
          {choices.length === 0 ? (
            <p>
              No Solana wallet found in this browser. Install one (Phantom, Solflare or Backpack), then reload this
              page.
            </p>
          ) : (
            <>
              <p>Your wallet signs every transaction itself. Samite never holds your keys.</p>
              <div className={s.opts}>
                {choices.map((w) => (
                  <button
                    key={w.name}
                    type="button"
                    className={s.opt}
                    disabled={busy}
                    onClick={async () => {
                      setError("")
                      setBusy(true)
                      try {
                        await w.connect()
                        dialog.current?.close()
                      } catch (e) {
                        if ((e as Error).name !== "AbortError")
                          setError((e as Error).message || "The wallet didn't connect.")
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- the wallet's own data: icon */}
                    {w.icon && <img src={w.icon} alt="" width={20} height={20} />}
                    <b>{w.name}</b>
                  </button>
                ))}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className={s.invalid}>
              {error}
            </p>
          )}
          <div className={s.dialogActions}>
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
          </div>
        </dialog>
      )}
    </>
  )
}
