import { address as toAddress, isAddress } from "@solana/kit"
import { fetchMaybeMachineStats, findMachineStatsPda } from "@samite/program-client"
import { handler } from "@/lib/server/http"
import { ApiError, json } from "@/lib/server/errors"
import { machineRecord } from "@/lib/server/jobs"

// GET /api/v1/machines/:address: MachineStats read from the chain, plus the index's history.
export const GET = handler<{ address: string }>(async ({ s }, { address }) => {
  if (!isAddress(address)) throw new ApiError("not_found", "That's not a Solana address.")
  const [pda] = await findMachineStatsPda({ machine: toAddress(address) }, { programAddress: s.program })
  const onChain = await fetchMaybeMachineStats(s.rpc, pda, { commitment: "confirmed" }).catch(() => null)
  return json({
    ...(await machineRecord(s.db, address)),
    chain: onChain?.exists
      ? { accepted: onChain.data.accepted, rejected: onChain.data.rejected, earned: onChain.data.earned.toString() }
      : null,
  })
})
