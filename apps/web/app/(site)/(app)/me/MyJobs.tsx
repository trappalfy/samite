"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { formatUsdc } from "@samite/config/money"
import { Ex } from "@samite/ui/components"
import { Amount, appClass as s, Segmented, Status, Tag } from "@samite/ui/app"
import type { GlyphKind } from "@samite/ui/components"
import { api } from "@/lib/wallet/api"
import { useWallet } from "@/lib/wallet/store"
import { nextLine, statusGlyph, type JobJson } from "@/lib/view"

type Row = {
  no: string
  title: string
  category: string
  reward: bigint
  status: { kind: GlyphKind; label: string }
  next: string
  link?: boolean
}

const POSTED: Row[] = [
  {
    no: "0415",
    title: "Scrape 2,000 real-estate listings",
    category: "Data",
    reward: 80_000_000n,
    status: { kind: "delivered", label: "Delivered" },
    next: "your review, or auto-release in 41h 12m",
    link: true,
  },
  {
    no: "0410",
    title: "Find 50 B2B leads in Polish logistics",
    category: "Research",
    reward: 95_000_000n,
    status: { kind: "open", label: "Open" },
    next: "refund to you if nobody delivers in 2d 02h",
  },
]
const WORKING: Row[] = [
  {
    no: "0413",
    title: "Write unit tests for a Rust crate (40% → 80%)",
    category: "Code",
    reward: 320_000_000n,
    status: { kind: "delivered", label: "Delivered" },
    next: "paid automatically if the poster doesn't answer in 46h 30m",
  },
  {
    no: "0414",
    title: "Run a 7B model eval on 1,200 prompts",
    category: "Compute",
    reward: 240_000_000n,
    status: { kind: "claimed", label: "Claimed" },
    next: "deliver before the deadline in 5d 00h",
  },
]

function useMine(): { posted: Row[]; working: Row[] } | null {
  const { connected } = useWallet()
  const [rows, setRows] = useState<{ posted: Row[]; working: Row[] } | null>(null)
  const me = connected?.address
  useEffect(() => {
    if (!me) return
    let live = true
    const now = Math.floor(Date.now() / 1000)
    const row =
      (as: "poster" | "machine") =>
      (j: JobJson): Row => {
        const g = statusGlyph(j.status, j.worker)
        return {
          no: j.no,
          title: j.title ?? `Job ${j.no}`,
          category: j.category ? j.category[0]!.toUpperCase() + j.category.slice(1) : "Other",
          reward: BigInt(j.reward),
          status: { kind: g.kind, label: g.label[0]!.toUpperCase() + g.label.slice(1) },
          next: nextLine(j, as, now),
          link: true,
        }
      }
    Promise.all([
      api<{ jobs: JobJson[] }>(`/jobs?poster=${me}&status=all&limit=100`),
      api<{ jobs: JobJson[] }>(`/jobs?worker=${me}&status=all&limit=100`),
    ])
      .then(([p, w]) => live && setRows({ posted: p.jobs.map(row("poster")), working: w.jobs.map(row("machine")) }))
      .catch(() => live && setRows({ posted: [], working: [] }))
    return () => {
      live = false
    }
  }, [me])
  return me ? rows : null
}

/** My jobs (§10): Posted / Working on, with status glyphs and what happens next if nobody acts. */
export function MyJobs({ example = false }: { example?: boolean }) {
  const [tab, setTab] = useState<"Posted" | "Working on">("Posted")
  const mine = useMine()
  const data = example ? { posted: POSTED, working: WORKING } : mine
  const rows = data ? (tab === "Posted" ? data.posted : data.working) : []
  return (
    <>
      <div className={s.head}>
        <div>
          <div className={s.crumbs}>My jobs</div>
          <h1>My jobs</h1>
          <div className={s.sub}>
            {example || data
              ? "Jobs you posted and jobs your machine works on"
              : "Connect a wallet to see the jobs you posted and work on."}{" "}
            {example && <Ex>(example)</Ex>}
          </div>
        </div>
        <Segmented label="Show" options={["Posted", "Working on"]} value={tab} onChange={setTab} />
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Job</th>
            <th className={s.r}>Reward</th>
            <th className={s.hideS}>Next</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.no}>
              <td>
                {r.link ? (
                  <Link className={s.jobT} href={example ? `/jobs/${r.no}?example` : `/jobs/${r.no}`}>
                    {r.title}
                  </Link>
                ) : (
                  <span className={s.jobT}>{r.title}</span>
                )}
                <div className={s.jobM}>
                  <span>JOB {r.no}</span>
                  <Tag>{r.category}</Tag>
                  <Status kind={r.status.kind} light>
                    {r.status.label}
                  </Status>
                </div>
              </td>
              <td className={s.r}>
                <Amount value={formatUsdc(r.reward)} />
              </td>
              <td className={`${s.hideS} ${s.who}`}>{r.next}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {example && (
        <div className={s.foot}>
          <Ex>example jobs and values</Ex>
        </div>
      )}
    </>
  )
}
