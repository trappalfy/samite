"use client"
// Sign-In With Solana: one signature opens a session (§6.1). The wallet's own `solana:signIn` when it has it,
// else `signMessage` over the same text.
import { getBase64Decoder } from "@solana/kit"
import { createSignInMessageText } from "@solana/wallet-standard-util"
import { api } from "./api"
import type { ConnectedWallet } from "./store"

const b64 = (bytes: Uint8Array) => getBase64Decoder().decode(bytes)

/** Makes sure the server's session is for the connected account; asks the wallet to sign in if not. */
export async function ensureSession(wallet: ConnectedWallet): Promise<string> {
  const address = wallet.address
  const me = await api<{ address: string | null }>("/session")
  if (me.address === address) return address

  const input = await api<Record<string, string>>("/session/challenge", { method: "POST", body: {} })
  let signedMessage: Uint8Array, signature: Uint8Array
  if (wallet.signIn) {
    const out = await wallet.signIn(input)
    if (out.address !== address) throw new Error("The wallet signed in with another account.")
    signedMessage = out.signedMessage
    signature = out.signature
  } else {
    const text = createSignInMessageText({ ...input, domain: input.domain!, address })
    signedMessage = new TextEncoder().encode(text)
    signature = await wallet.signMessage(signedMessage)
  }
  await api("/session", {
    method: "POST",
    body: { address, signedMessage: b64(signedMessage), signature: b64(signature) },
  })
  return address
}

export const signOut = () => api("/session", { method: "DELETE" })
