// Send instructions with Kit: build, sign with the signers inside the instructions, confirm.
import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit"
import { LOCAL_RPC, LOCAL_WS } from "./validator"

export type Client = ReturnType<typeof localClient>

export function localClient(rpcUrl = LOCAL_RPC, wsUrl = LOCAL_WS) {
  const rpc = createSolanaRpc(rpcUrl)
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl)
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })
  async function send(feePayer: TransactionSigner, instructions: Instruction[]) {
    const { value: blockhash } = await rpc.getLatestBlockhash().send()
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    )
    const signed = await signTransactionMessageWithSigners(msg)
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], { commitment: "confirmed" })
    return getSignatureFromTransaction(signed)
  }
  return { rpc, rpcSubscriptions, send }
}
