"use client"
// The browser's own check of a job against the chain (§12): whatever the API says, the job page shows the
// account's status and hashes as the RPC reports them, and says so when they differ.
import { useEffect, useState } from "react"
import { address, isSome } from "@solana/kit"
import { fetchMaybeJob, JobStatus } from "@samite/program-client"
import { browserRpc } from "./client"
import { errorText } from "./errors"

export type ChainView =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "closed" }
  | {
      state: "live"
      status: "open" | "claimed" | "delivered"
      worker: string | null
      deliveryHash: string | null
      specHash: string
      reward: bigint
      deliveries: number
      deliveredAt: number
      reviewWindow: number
      deadline: number
    }

const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
const STATUS = { [JobStatus.Open]: "open", [JobStatus.Claimed]: "claimed", [JobStatus.Delivered]: "delivered" } as const

export async function readChainJob(pda: string): Promise<ChainView> {
  const a = await fetchMaybeJob(browserRpc(), address(pda), { commitment: "confirmed" })
  if (!a.exists) return { state: "closed" }
  const j = a.data
  const zero = j.deliveryHash.every((b) => b === 0)
  return {
    state: "live",
    status: STATUS[j.status],
    worker: isSome(j.worker) ? j.worker.value : null,
    deliveryHash: zero ? null : hex(j.deliveryHash),
    specHash: hex(j.specHash),
    reward: j.reward,
    deliveries: j.deliveries,
    deliveredAt: Number(j.deliveredAt),
    reviewWindow: Number(j.reviewWindow),
    deadline: Number(j.deadline),
  }
}

export function useChainJob(pda: string, refresh = 0): ChainView {
  const [v, setV] = useState<ChainView>({ state: "loading" })
  useEffect(() => {
    let live = true
    readChainJob(pda)
      .then((r) => live && setV(r))
      .catch((e: unknown) => live && setV({ state: "error", message: errorText(e) }))
    return () => {
      live = false
    }
  }, [pda, refresh])
  return v
}

/** sha256 of the spec bytes the API serves, computed here (WebCrypto), to compare with the chain's spec_hash. */
export async function servedSpecHash(ref: string): Promise<string> {
  const bytes = await (await fetch(`/api/v1/jobs/${ref}/spec.json`)).arrayBuffer()
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
}
