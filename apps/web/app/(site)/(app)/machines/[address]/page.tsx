import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { address as toAddress, isAddress } from "@solana/kit"
import { formatUsdc, shortAddress } from "@samite/config/money"
import { fetchMaybeMachineStats, findMachineStatsPda } from "@samite/program-client"
import { Ex, type GlyphKind } from "@samite/ui/components"
import { ActivityGrid, Avatar, appClass as s, exampleCounts, seedFromAddress, Status, Tag } from "@samite/ui/app"
import { isExample, requestTime, type Search } from "@/lib/data"
import { EXAMPLE_JOB, EXAMPLE_MACHINE as M } from "@/lib/examples"
import { server } from "@/lib/server/context"
import { machineDays, machineRecord } from "@/lib/server/jobs"
import { duration } from "@/lib/view"

type View = {
  title: string
  crumb: string
  line: string
  seed: number
  accepted: number
  earned: bigint
  rate: string
  median: string
  counts: number[]
  byCategory: { category: string; n: number }[]
  history: {
    no: string
    href?: string
    title: string
    category: string
    paid: bigint | null
    took: string | null
    outcome: { kind: GlyphKind; label: string }
  }[]
  example: boolean
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  return { title: `Machine ${shortAddress((await params).address)}` }
}

export default async function MachinePage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>
  searchParams: Search
}) {
  const { address } = await params
  if (await isExample(searchParams)) {
    if (address !== M.address) notFound()
    return (
      <MachineView
        v={{
          title: M.label,
          crumb: M.short,
          line: `${M.long} · ${M.kind} · connected via ${M.via} · first job ${M.firstJob}`,
          seed: M.avatarSeed,
          accepted: M.accepted,
          earned: M.earned,
          rate: M.rate,
          median: M.median,
          counts: exampleCounts(),
          byCategory: M.byCategory,
          history: M.history.map((h) => ({
            ...h,
            href: h.no === EXAMPLE_JOB.no ? `/jobs/${h.no}?example` : undefined,
          })),
          example: true,
        }}
      />
    )
  }
  if (!isAddress(address)) notFound()
  const s0 = await server()
  const now = requestTime()
  const [rec, counts, chain] = await Promise.all([
    machineRecord(s0.db, address),
    machineDays(s0.db, address, now),
    findMachineStatsPda({ machine: toAddress(address) }, { programAddress: s0.program }).then(([pda]) =>
      fetchMaybeMachineStats(s0.rpc, pda, { commitment: "confirmed" }),
    ),
  ])
  // the counts are the chain's (MachineStats); the index gives the history around them
  const accepted = chain.exists ? chain.data.accepted : rec.accepted
  const rejected = chain.exists ? chain.data.rejected : rec.rejected
  const earned = chain.exists ? chain.data.earned : BigInt(rec.earned)
  const took = rec.history
    .filter((h) => h.claimed_at && h.delivered_at)
    .map((h) => h.delivered_at! - h.claimed_at!)
    .sort((a, b) => a - b)
  const cats = new Map<string, number>()
  for (const h of rec.history)
    if (h.status === "paid") cats.set(h.category ?? "other", (cats.get(h.category ?? "other") ?? 0) + 1)
  const cap = (c: string) => c[0]!.toUpperCase() + c.slice(1)
  const outcome = (st: string): { kind: GlyphKind; label: string } =>
    (({
      paid: { kind: "paid", label: "Accepted" },
      delivered: { kind: "delivered", label: "In review" },
      claimed: { kind: "claimed", label: "Working" },
      refunded: { kind: "refunded", label: "Refunded" },
    })[st] as never) ?? { kind: "open", label: cap(st) }
  return (
    <MachineView
      v={{
        title: rec.label ?? shortAddress(address),
        crumb: shortAddress(address),
        line: `${address}${rec.first_seen ? ` · first claim ${new Date(rec.first_seen * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : " · no jobs yet"}`,
        seed: seedFromAddress(address),
        accepted,
        earned,
        rate: accepted + rejected ? `${Math.round((100 * accepted) / (accepted + rejected))}%` : "—",
        median: took.length ? duration(took[Math.floor(took.length / 2)]!) : "—",
        counts,
        byCategory: [...cats].map(([category, n]) => ({ category: cap(category), n })).sort((a, b) => b.n - a.n),
        history: rec.history.map((h) => ({
          no: h.no,
          href: `/jobs/${h.no}`,
          title: h.title ?? `Job ${h.no}`,
          category: cap(h.category ?? "other"),
          paid: h.status === "paid" ? BigInt(h.to_machine) : null,
          took: h.claimed_at && h.delivered_at ? duration(h.delivered_at - h.claimed_at) : null,
          outcome: outcome(h.status),
        })),
        example: false,
      }}
    />
  )
}

function MachineView({ v }: { v: View }) {
  const max = Math.max(1, ...v.byCategory.map((c) => c.n))
  return (
    <main>
      <div className={s.mhead}>
        <Avatar seed={v.seed} size={132} />
        <div>
          <div className={s.crumbs}>
            <Link href={v.example ? "/machines?example" : "/machines"}>Machines</Link> / {v.crumb}
          </div>
          <h1>{v.title}</h1>
          <div className={s.addr}>{v.line}</div>
        </div>
      </div>
      <div className={s.stats}>
        <div>
          <div className={`${s.mono} ${s.dim}`}>Accepted jobs</div>
          <div className={s.v}>{v.accepted}</div>
        </div>
        <div>
          <div className={`${s.mono} ${s.dim}`}>Earned</div>
          <div className={s.v}>
            {formatUsdc(v.earned)} <span>USDC</span>
          </div>
        </div>
        <div>
          <div className={`${s.mono} ${s.dim}`}>Acceptance rate</div>
          <div className={s.v}>{v.rate}</div>
        </div>
        <div>
          <div className={`${s.mono} ${s.dim}`}>Median delivery</div>
          <div className={s.v}>{v.median}</div>
        </div>
      </div>
      <div className={s.gridAct}>
        <div>
          <div className={`${s.mono} ${s.dim}`} style={{ marginBottom: 14 }}>
            Accepted jobs per day · last 26 weeks
          </div>
          <ActivityGrid
            counts={v.counts}
            label={`Accepted jobs per day over the last 26 weeks${v.example ? " (example)" : ""}`}
          />
        </div>
        <div>
          <div className={`${s.mono} ${s.dim}`} style={{ marginBottom: 14 }}>
            Work by category
          </div>
          <div className={s.bycat}>
            {v.byCategory.length === 0 && <span className={s.dim}>No accepted jobs yet.</span>}
            {v.byCategory.map((c) => (
              <div key={c.category}>
                <span>{c.category}</span>
                <i style={{ width: `${(c.n / max) * 100}%` }} aria-hidden="true" />
                <b>{c.n}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Job</th>
            <th className={s.r}>Paid</th>
            <th className={s.hideXs}>Delivered in</th>
            <th className={s.hideS}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {v.history.map((h) => (
            <tr key={h.no}>
              <td>
                {h.href ? (
                  <Link className={s.jobT} href={h.href}>
                    {h.title}
                  </Link>
                ) : (
                  <span className={s.jobT}>{h.title}</span>
                )}
                <div className={s.jobM}>
                  <span>JOB {h.no}</span>
                  <Tag>{h.category}</Tag>
                </div>
              </td>
              <td className={`${s.r} ${s.amt}`}>{h.paid === null ? "—" : formatUsdc(h.paid)}</td>
              <td className={`${s.hideXs} ${s.num}`}>{h.took ?? "—"}</td>
              <td className={s.hideS}>
                <Status kind={h.outcome.kind}>{h.outcome.label}</Status>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {v.example && (
        <div className={s.foot}>
          <Ex>example machine and values</Ex>
        </div>
      )}
    </main>
  )
}
