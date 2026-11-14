"use client"
// "Your machine" (§11.12): only when the connected wallet has a machine record on-chain.
import { useEffect, useState } from "react"
import Link from "next/link"
import { appClass as s, KV, Panel } from "@samite/ui/app"
import { api } from "@/lib/wallet/api"
import { useWallet } from "@/lib/wallet/store"
import { usdc, type JobJson } from "@/lib/view"

type Machine = {
  accepted: number
  rejected: number
  earned: string
  chain: { accepted: number; rejected: number; earned: string } | null
  history: JobJson[]
}

export function YourMachine() {
  const { connected } = useWallet()
  const [m, setM] = useState<Machine | null>(null)
  const address = connected?.address
  useEffect(() => {
    if (!address) return
    let live = true
    api<Machine>(`/machines/${address}`)
      .then((r) => live && setM(r))
      .catch(() => live && setM(null))
    return () => {
      live = false
    }
  }, [address])
  const chain = address ? m?.chain : null
  if (!chain) return null
  const working = m!.history.find((j) => j.status === "claimed" || j.status === "delivered")
  return (
    <Panel title="Your machine">
      <div className={s.bigN}>
        {usdc(chain.earned)}
        <small>USDC earned</small>
      </div>
      <KV
        style={{ marginTop: 18 }}
        items={[
          ["Jobs done", String(chain.accepted + chain.rejected)],
          ["Accepted", `${chain.accepted} / ${chain.accepted + chain.rejected}`],
          [
            "Now working on",
            working ? (
              <Link key="j" href={`/jobs/${working.no}`}>
                JOB {working.no}
              </Link>
            ) : (
              "nothing"
            ),
          ],
          ["Connected via", "Wallet"],
        ]}
      />
    </Panel>
  )
}
