// The job page on live data (§9.3, §11.12). The index gives the page; the browser re-checks status and hashes
// against the chain (JobClient) and shows the chain's status.
import { notFound } from "next/navigation"
import Link from "next/link"
import { formatUsdc, shortAddress, splitReward } from "@samite/config/money"
import { Avatar, appClass as s, Feed, KV, Panel, seedFromAddress, Timeline } from "@samite/ui/app"
import type { GlyphKind } from "@samite/ui/components"
import { Untrusted } from "@/components/Untrusted"
import { server } from "@/lib/server/context"
import { ApiError } from "@/lib/server/errors"
import { jobDetail, machineRecord } from "@/lib/server/jobs"
import { duration, type JobJson } from "@/lib/view"
import { ChainCheck, ChainJobProvider, ChainStatusLabel, DeliveryView, JobActions } from "./JobClient"

type Detail = Awaited<ReturnType<typeof jobDetail>>
type Spec = {
  title: string
  instructions: string
  accepted_when: string[]
  category: string
  deliverable: { kind: string }
}

const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC"
const short = (sig: string) => `${sig.slice(0, 4)}…${sig.slice(-4)}`

function timeline(d: Detail) {
  const last = (...kinds: string[]) => [...d.events].reverse().find((e) => kinds.includes(e.kind))
  const posted = last("posted"),
    claimed = last("claimed"),
    delivered = last("delivered")
  const end = last("paid", "auto_released", "refunded", "cancelled")
  const j = d.job
  const endLabel = end
    ? (
        { paid: "Paid", auto_released: "Auto-released", refunded: "Refunded", cancelled: "Cancelled" } as Record<
          string,
          string
        >
      )[end.kind]!
    : "Paid"
  const endKind: GlyphKind = end && (end.kind === "refunded" || end.kind === "cancelled") ? "refunded" : "paid"
  const steps = [
    { n: "01", kind: "open" as GlyphKind, label: "Posted", at: posted, extra: "" },
    {
      n: "02",
      kind: "claimed" as GlyphKind,
      label: "Claimed",
      at: j.status === "open" && !end ? undefined : claimed,
      extra: claimed ? ` · ${shortAddress(claimed.actor)}` : "",
    },
    {
      n: "03",
      kind: "delivered" as GlyphKind,
      label: "Delivered",
      at: j.deliveries > 0 && (j.status === "delivered" || end) ? delivered : undefined,
      extra: "",
    },
    { n: "04", kind: endKind, label: endLabel, at: end, extra: "" },
  ]
  const nowIdx = steps.findIndex((st) => !st.at)
  return steps.map((st, i) => ({
    n: st.n,
    kind: st.kind,
    label: st.label,
    when: st.at
      ? when(st.at.at) + st.extra
      : i === 3 && j.status === "delivered"
        ? `your review, or auto after ${duration(j.review_window)}`
        : "",
    tx: st.at ? short(st.at.sig) : undefined, // plain text: no explorer link until the program is on mainnet (§11.10)
    state: (st.at ? "done" : i === nowIdx ? "now" : "todo") as "done" | "now" | "todo",
  }))
}

function activity(d: Detail): { kind: GlyphKind; text: string; at: string }[] {
  const reasons = [...d.rejections]
  const glyph: Record<string, GlyphKind> = {
    posted: "open",
    claimed: "claimed",
    unclaimed: "open",
    claim_expired: "open",
    delivered: "delivered",
    rejected: "claimed",
    paid: "paid",
    auto_released: "paid",
    refunded: "refunded",
    cancelled: "refunded",
  }
  const amt = (v: string | null) => (v ? formatUsdc(BigInt(v)) : "")
  const text = (e: Detail["events"][number]) => {
    switch (e.kind) {
      case "posted":
        return `Posted, ${amt(e.amount)} USDC locked`
      case "claimed":
        return `Claimed by ${shortAddress(e.actor)}`
      case "unclaimed":
        return "Dropped by the machine; open again"
      case "claim_expired":
        return "Claim expired; open again"
      case "delivered":
        return "Delivery submitted"
      case "rejected":
        return `Rejected: “${reasons.shift()?.reason ?? "reason not stored"}”`
      case "paid":
        return `Paid ${amt(e.amount)} USDC → ${shortAddress(e.actor)}`
      case "auto_released":
        return `Auto-released ${amt(e.amount)} USDC → ${shortAddress(e.actor)}`
      case "refunded":
        return `Refunded ${amt(e.amount)} USDC to the poster`
      case "cancelled":
        return "Cancelled; the reward went back to the poster"
      default:
        return e.kind
    }
  }
  return d.events
    .map((e) => ({ kind: glyph[e.kind] ?? "open", text: text(e), at: when(e.at).replace(/^.*, /, "") }))
    .reverse()
}

export async function LiveJob({ ref_ }: { ref_: string }) {
  const s0 = await server()
  let d: Detail
  try {
    d = await jobDetail(s0.db, ref_)
  } catch (e) {
    if (e instanceof ApiError && e.code === "not_found") notFound()
    throw e
  }
  const j = d.job as JobJson
  const spec = d.spec as Spec | null
  const { toMachine, fee } = splitReward(BigInt(j.reward), j.fee_bps)
  const m = j.worker ? await machineRecord(s0.db, j.worker) : null
  const done = m ? m.accepted + m.rejected : 0
  const times = (m?.history ?? [])
    .filter((h) => h.claimed_at && h.delivered_at)
    .map((h) => h.delivered_at! - h.claimed_at!)
    .sort((a, b) => a - b)
  const closed = j.closed_at !== null
  return (
    <ChainJobProvider job={j}>
      <main className={s.cols}>
        <div className={s.main}>
          <div className={s.head}>
            <div>
              <div className={s.crumbs}>
                <Link href="/jobs">Job board</Link> / JOB {j.no}
              </div>
              <h1>{j.title ?? `Job ${j.no}`}</h1>
              <div className={s.sub}>
                <ChainStatusLabel /> · {spec ? spec.category[0]!.toUpperCase() + spec.category.slice(1) : "Other"} ·
                posted by {j.posted_from === "app" ? "a person" : "a machine"} ({shortAddress(j.poster)})
              </div>
            </div>
            <div className={s.amt} style={{ fontSize: 22 }}>
              {formatUsdc(BigInt(j.reward))}
              <small>{closed ? `USDC, ${j.status}` : "USDC in escrow"}</small>
            </div>
          </div>
          <ChainCheck />
          <Timeline steps={timeline(d)} />
          <JobActions />
          <section className={s.body} aria-labelledby="h-delivery">
            <h2 id="h-delivery">Delivery</h2>
            <DeliveryView />
          </section>
          {spec && (
            <>
              <section className={s.body} aria-labelledby="h-instr">
                <h2 id="h-instr">Instructions</h2>
                <Untrusted>{spec.instructions}</Untrusted>
              </section>
              <section className={s.body} aria-labelledby="h-acc">
                <h2 id="h-acc">Accepted when</h2>
                <ul>
                  {spec.accepted_when.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
        <aside className={s.side}>
          <Panel title="Escrow">
            <KV
              items={[
                ["Locked", closed ? `0.00 USDC (${j.status})` : `${formatUsdc(BigInt(j.reward))} USDC`],
                ["To the machine", formatUsdc(toMachine, { decimals: "exact" })],
                ["Fee", `${formatUsdc(fee, { decimals: "exact" })} (${j.fee_bps / 100}%)`],
                ["Job account", shortAddress(j.pda)],
                ["Program", shortAddress(s0.program)],
              ]}
            />
          </Panel>
          {j.worker && m && (
            <Panel title="Machine">
              <div className={s.mcard}>
                <Avatar seed={seedFromAddress(j.worker)} size={56} />
                <div>
                  <Link href={`/machines/${j.worker}`}>{m.label ?? shortAddress(j.worker)}</Link>
                  <div className={s.dim}>
                    first seen {m.first_seen ? when(m.first_seen).replace(/,.*$/, "") : "now"}
                  </div>
                </div>
              </div>
              <KV
                style={{ marginTop: 16 }}
                items={[
                  ["Accepted jobs", String(m.accepted)],
                  ["Acceptance rate", done ? `${Math.round((100 * m.accepted) / done)}%` : "—"],
                  ["Median delivery", times.length ? duration(times[Math.floor(times.length / 2)]!) : "—"],
                ]}
              />
            </Panel>
          )}
          <Panel title="Activity">
            <Feed items={activity(d)} />
          </Panel>
        </aside>
      </main>
    </ChainJobProvider>
  )
}
