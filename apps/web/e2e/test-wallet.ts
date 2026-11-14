// A Wallet Standard wallet injected into the page for the acceptance run (local validator only). It registers like a
// browser extension does (wallet-standard:app-ready / register-wallet), and every signature is made in the Node test
// process with a key from the local harness (.data/local/keys), exposed through page.exposeFunction: no key enters
// the page.
import {
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  signBytes,
  signTransaction,
  type KeyPairSigner,
} from "@solana/kit"
import { createSignInMessageText } from "@solana/wallet-standard-util"
import type { Page } from "@playwright/test"

export type WalletLog = { kind: "tx" | "message" | "signIn"; at: number }[]

export async function injectTestWallet(
  page: Page,
  signer: KeyPairSigner,
  name = "Samite Test Wallet",
): Promise<WalletLog> {
  const log: WalletLog = []
  const b64 = getBase64Decoder(),
    unb64 = getBase64Encoder()
  await page.exposeFunction("__testWalletSign", async (kind: "tx" | "message" | "signIn", payload: string) => {
    log.push({ kind, at: Date.now() })
    if (kind === "tx") {
      const tx = getTransactionDecoder().decode(unb64.encode(payload))
      return b64.decode(getTransactionEncoder().encode(await signTransaction([signer.keyPair], tx)))
    }
    if (kind === "message") return b64.decode(await signBytes(signer.keyPair.privateKey, unb64.encode(payload)))
    // signIn: the wallet builds the SIWS text from the app's input and its own address, as a real wallet does
    const text = createSignInMessageText({ ...JSON.parse(payload), address: signer.address })
    const bytes = new TextEncoder().encode(text)
    return JSON.stringify({
      signedMessage: b64.decode(bytes),
      signature: b64.decode(await signBytes(signer.keyPair.privateKey, bytes)),
    })
  })
  await page.addInitScript(
    ({ name, address, publicKey }) => {
      type Sign = (kind: string, payload: string) => Promise<string>
      const sign = (window as unknown as { __testWalletSign: Sign }).__testWalletSign
      const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
      const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
      const chains = ["solana:localnet"] as const
      const account = {
        address,
        publicKey: new Uint8Array(publicKey),
        chains,
        features: ["solana:signTransaction", "solana:signMessage", "solana:signIn"],
      }
      const listeners: ((p: unknown) => void)[] = []
      const wallet = {
        version: "1.0.0" as const,
        name,
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMCAxMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjRjJFRkU4Ii8+PC9zdmc+",
        chains,
        accounts: [] as (typeof account)[],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              wallet.accounts = [account]
              listeners.forEach((l) => l({ accounts: wallet.accounts }))
              return { accounts: wallet.accounts }
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              wallet.accounts = []
              listeners.forEach((l) => l({ accounts: [] }))
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (_event: string, listener: (p: unknown) => void) => {
              listeners.push(listener)
              return () => listeners.splice(listeners.indexOf(listener), 1)
            },
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
              Promise.all(
                inputs.map(async (i) => ({ signedTransaction: fromB64(await sign("tx", toB64(i.transaction))) })),
              ),
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async (...inputs: { message: Uint8Array }[]) =>
              Promise.all(
                inputs.map(async (i) => ({
                  signedMessage: i.message,
                  signature: fromB64(await sign("message", toB64(i.message))),
                })),
              ),
          },
          "solana:signIn": {
            version: "1.0.0",
            signIn: async (...inputs: Record<string, unknown>[]) =>
              Promise.all(
                inputs.map(async (input) => {
                  wallet.accounts = [account]
                  const r = JSON.parse(await sign("signIn", JSON.stringify(input))) as {
                    signedMessage: string
                    signature: string
                  }
                  return {
                    account,
                    signedMessage: fromB64(r.signedMessage),
                    signature: fromB64(r.signature),
                    signatureType: "ed25519",
                  }
                }),
              ),
          },
        },
      }
      const callback = ({ register }: { register: (w: unknown) => void }) => register(wallet)
      class RegisterWalletEvent extends Event {
        readonly #detail = callback
        get detail() {
          return this.#detail
        }
        override get type() {
          return "wallet-standard:register-wallet"
        }
        constructor() {
          super("wallet-standard:register-wallet", { bubbles: false, cancelable: false, composed: false })
        }
      }
      window.dispatchEvent(new RegisterWalletEvent())
      window.addEventListener("wallet-standard:app-ready", ((e: CustomEvent) => callback(e.detail)) as EventListener)
    },
    { name, address: signer.address, publicKey: Array.from(getAddressEncoder().encode(signer.address)) },
  )
  return log
}
