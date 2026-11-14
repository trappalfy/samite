"use client"
// Signing what the API built: decode the unsigned transaction and check it does exactly what the page asked for
// (verify.ts: the one Samite instruction, this job, your wallet, the amounts and hashes computed here), let the wallet
// sign (or sign and send), then wait for it on the browser's own RPC. The server never signs (§12).
import { address, getBase58Decoder, getBase64Decoder, getBase64Encoder, type Signature } from "@solana/kit"
import { api } from "./api"
import { browserRpc } from "./client"
import type { ConnectedWallet } from "./store"
import { errorText } from "./errors"
import { verifyTransaction, type Expected } from "./verify"

/** Where signAndSend is: waiting for the wallet, relaying the signed transaction, waiting for the network. */
export type SendStep = "sign" | "send" | "confirm"

export async function signAndSend(
  wallet: ConnectedWallet,
  base64: string,
  expected: Expected,
  onStep?: (at: SendStep) => void,
): Promise<string> {
  const why = verifyTransaction(base64, expected, address(wallet.address))
  if (why) throw new Error(`This transaction was not signed: ${why}.`)
  const wire = Uint8Array.from(getBase64Encoder().encode(base64))

  let signature: string
  onStep?.("sign")
  if (wallet.signTransaction) {
    const signed = await wallet.signTransaction(wire)
    onStep?.("send")
    signature = (
      await api<{ signature: string }>("/tx/send", { body: { transaction: getBase64Decoder().decode(signed) } })
    ).signature
  } else if (wallet.signAndSendTransaction) {
    signature = getBase58Decoder().decode(await wallet.signAndSendTransaction(wire))
  } else throw new Error("This wallet can't sign transactions.")
  onStep?.("confirm")
  await confirmed(signature)
  return signature
}

type Status = { err: unknown; status: string | null }

/**
 * Resolves once the network has confirmed the transaction; throws if it failed on-chain. Asks the chain through the
 * browser's own RPC first; if that fails (its key refused, rate-limited), Samite's server asks with its own
 * (GET /api/v1/tx/status), so a transaction that went through is never reported as an error.
 */
export async function confirmed(signature: string, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs
  let viaServer = false
  while (Date.now() < until) {
    let st: Status | null = null
    if (!viaServer)
      try {
        const { value } = await browserRpc()
          .getSignatureStatuses([signature as Signature])
          .send()
        st = value[0] ? { err: value[0].err, status: value[0].confirmationStatus } : null
      } catch (e) {
        console.error(JSON.stringify({ msg: "browser rpc failed; confirming through the server", error: errorText(e) }))
        viaServer = true
        continue
      }
    else st = await api<Status>(`/tx/status?signature=${encodeURIComponent(signature)}`)
    if (st?.err) throw new Error("The transaction failed on-chain; nothing changed.")
    if (st?.status === "confirmed" || st?.status === "finalized") return
    await new Promise((r) => setTimeout(r, viaServer ? 1_500 : 600))
  }
  throw new Error("The network hasn't confirmed the transaction yet. Check again in a minute.")
}
