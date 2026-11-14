// The keeper's view of the chain over an RPC.
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  fetchEncodedAccount,
  getSignatureFromTransaction,
  isSome,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  type TransactionSigner,
} from "@solana/kit"
import { fetchSysvarClock } from "@solana/sysvars"
import { fetchConfig, fetchMaybeJob, findConfigPda, JobStatus, type Job } from "@samite/program-client"
import type { ChainJob, KeeperChain } from "./keeper"

const STATUS = { [JobStatus.Open]: "open", [JobStatus.Claimed]: "claimed", [JobStatus.Delivered]: "delivered" } as const

export function toChainJob(j: Job): ChainJob {
  return {
    status: STATUS[j.status],
    poster: j.poster,
    worker: isSome(j.worker) ? j.worker.value : null,
    deadline: j.deadline,
    reviewWindow: j.reviewWindow,
    claimWindow: j.claimWindow,
    claimedAt: j.claimedAt,
    deliveredAt: j.deliveredAt,
    deliveries: j.deliveries,
  }
}

export function rpcChain(o: {
  rpc: Rpc<SolanaRpcApi>
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>
  signer: TransactionSigner
  programAddress?: Address
}): KeeperChain {
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc: o.rpc, rpcSubscriptions: o.rpcSubscriptions })
  const cfg = { programAddress: o.programAddress }
  return {
    now: async () => (await fetchSysvarClock(o.rpc, { commitment: "confirmed" })).unixTimestamp,
    job: async (address) => {
      const a = await fetchMaybeJob(o.rpc, address, { commitment: "confirmed" })
      return a.exists ? toChainJob(a.data) : null
    },
    exists: async (address) => (await fetchEncodedAccount(o.rpc, address, { commitment: "confirmed" })).exists,
    treasury: async () => (await fetchConfig(o.rpc, (await findConfigPda(cfg))[0])).data.treasury,
    send: async (instructions) => {
      const { value: blockhash } = await o.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()
      const msg = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(o.signer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
      )
      const signed = await signTransactionMessageWithSigners(msg)
      await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], { commitment: "confirmed" })
      return getSignatureFromTransaction(signed)
    },
  }
}
