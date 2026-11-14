"use client"
// The Wallet Standard layer (@solana/kit-plugin-wallet): the wallets in this browser, listed in the app's own dialog.
// Used where Privy isn't configured: local runs on `solana:localnet` and the end-to-end tests (their test wallet
// registers as a Wallet Standard wallet). It writes the connected wallet into store.ts.
import { useEffect } from "react"
import { getTransactionDecoder, getTransactionEncoder } from "@solana/kit"
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react"
import { walletClient } from "./client"
import { setWallet, type ConnectedWallet } from "./store"

const txIn = (wire: Uint8Array) => getTransactionDecoder().decode(wire)
const txOut = (tx: Parameters<ReturnType<typeof getTransactionEncoder>["encode"]>[0]) =>
  Uint8Array.from(getTransactionEncoder().encode(tx))
// copied out of the wallet's (possibly frozen) arrays
const bytes = (b: ArrayLike<number>) => Uint8Array.from(b)

export function StandardWallet() {
  const client = walletClient()
  const status = useWalletStatus(client)
  const wallets = useWallets(client)
  const connected = useConnectedWallet(client)
  const { dispatchAsync: connect } = useConnect(client)
  const { dispatchAsync: disconnect } = useDisconnect(client)

  useEffect(() => {
    let wallet: ConnectedWallet | null = null
    if (connected) {
      const signer = connected.signer
      const ui = connected.wallet
      wallet = {
        address: connected.account.address,
        name: ui.name,
        signTransaction:
          signer && "modifyAndSignTransactions" in signer
            ? async (wire) => {
                const [signed] = await signer.modifyAndSignTransactions([txIn(wire)])
                return txOut(signed!)
              }
            : undefined,
        signAndSendTransaction:
          signer && "signAndSendTransactions" in signer
            ? async (wire) => {
                const [sig] = await signer.signAndSendTransactions([txIn(wire)])
                return bytes(sig!)
              }
            : undefined,
        signMessage: async (message) => bytes(await client.wallet.signMessage(message)),
        signIn: ui.features.includes("solana:signIn")
          ? async (input) => {
              const out = await client.wallet.signIn(ui, input)
              return {
                address: out.account.address,
                signedMessage: bytes(out.signedMessage),
                signature: bytes(out.signature),
              }
            }
          : undefined,
      }
    }
    setWallet({
      layer: "standard",
      ready: status !== "pending" && status !== "reconnecting",
      connected: wallet,
      choices: wallets.map((w) => ({
        name: w.name,
        icon: w.icon,
        connect: async () => {
          await connect(w)
        },
      })),
      open: null,
      disconnect: async () => {
        await disconnect()
      },
    })
  }, [client, status, wallets, connected, connect, disconnect])

  return null
}
