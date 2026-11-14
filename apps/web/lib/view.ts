// What the app shows, computed from index rows (or the chain): pure, shared by server pages and client components.
import { formatUsdc, shortAddress } from "@samite/config/money"
import type { GlyphKind } from "@samite/ui/components"

/** "41h 12m", "2d 22h", "12m", "45s" (§11.11). */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86_400),
    h = Math.floor((s % 86_400) / 3_600),
    m = Math.floor((s % 3_600) / 60)
  if (d >= 2) return `${d}d ${String(h).padStart(2, "0")}h`
  if (s >= 3_600) return `${d * 24 + h}h ${String(m).padStart(2, "0")}m`
  if (s >= 60) return `${m}m`
  return `${s}s`
}

/** "12s", "48s", "1m", "3h", "2d" ago (§11.11). */
export function ago(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  if (s < 3_600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3_600)}h`
  return `${Math.floor(s / 86_400)}d`
}

export const usdc = (v: bigint | string) => formatUsdc(typeof v === "string" ? BigInt(v) : v)
const cap = (s: string | null) => (s ? s[0]!.toUpperCase() + s.slice(1) : "Other")

export type JobStatus = "open" | "claimed" | "delivered" | "paid" | "refunded" | "cancelled"

export function statusGlyph(status: JobStatus, worker?: string | null): { kind: GlyphKind; label: string } {
  switch (status) {
    case "open":
      return { kind: "open", label: "open" }
    case "claimed":
      return { kind: "claimed", label: worker ? `claimed by ${shortAddress(worker)}` : "claimed" }
    case "delivered":
      return { kind: "delivered", label: "delivered in review" }
    case "paid":
      return { kind: "paid", label: "paid" }
    case "refunded":
      return { kind: "refunded", label: "refunded" }
    case "cancelled":
      return { kind: "refunded", label: "cancelled" }
  }
}

/** What the API's /jobs gives for a job (lib/server/jobs.ts jobView), as the browser sees it. */
export type JobJson = {
  no: string
  pda: string
  status: JobStatus
  poster: string
  posted_from: "app" | "api"
  worker: string | null
  title: string | null
  category: string | null
  reward: string
  fee_bps: number
  to_machine: string
  fee: string
  deadline: number
  review_window: number
  claim_window: number
  deliveries: number
  delivery_hash: string | null
  spec_hash: string
  created_at: number
  claimed_at: number | null
  delivered_at: number | null
  closed_at: number | null
}

export type BoardRow = {
  no: string
  href: string
  title: string
  category: string
  reward: bigint
  deadlineAt: number
  deadlineIn: string
  postedBy: { kind: "person" | "machine"; address?: string }
  status: { kind: GlyphKind; label: string }
}

export function boardRow(j: JobJson, nowSec: number): BoardRow {
  return {
    no: j.no,
    href: `/jobs/${j.no}`,
    title: j.title ?? `Job ${j.no}`,
    category: cap(j.category),
    reward: BigInt(j.reward),
    deadlineAt: j.deadline,
    deadlineIn: j.deadline > nowSec ? duration(j.deadline - nowSec) : "passed",
    postedBy: j.posted_from === "app" ? { kind: "person" } : { kind: "machine", address: shortAddress(j.poster) },
    status: statusGlyph(j.status, j.worker),
  }
}

export type EventJson = { id: number; job: string; kind: string; actor: string; amount: string | null; at: number }

export function feedItem(e: EventJson, nowSec: number): { kind: GlyphKind; text: string; at: string } {
  const amt = e.amount ? usdc(e.amount) : ""
  const who = shortAddress(e.actor)
  const lines: Record<string, [GlyphKind, string]> = {
    posted: ["open", `${e.job} posted · ${amt} USDC`],
    claimed: ["claimed", `${e.job} claimed by ${who}`],
    unclaimed: ["open", `${e.job} reopened`],
    claim_expired: ["open", `${e.job} claim expired, reopened`],
    delivered: ["delivered", `${e.job} delivered`],
    rejected: ["claimed", `${e.job} delivery rejected`],
    paid: ["paid", `${e.job} paid ${amt} → ${who}`],
    auto_released: ["paid", `${e.job} auto-released ${amt} → ${who}`],
    refunded: ["refunded", `${e.job} refunded ${amt} → poster`],
    cancelled: ["refunded", `${e.job} cancelled · ${amt} back to the poster`],
  }
  const [kind, text] = lines[e.kind] ?? ["open", `${e.job} ${e.kind}`]
  return { kind, text, at: ago(nowSec - e.at) }
}

/**
 * The time-out that applies to a job now, in the program's own terms (§4.3; DECISIONS "Time boundaries"):
 * auto-release once `now > delivered_at + review_window`, refund once `now > deadline` (never while delivered).
 * `left` is seconds until the program would accept the instruction, so it is 0 only when it already would.
 */
export function pendingTimeout(
  j: Pick<JobJson, "status" | "deadline" | "review_window" | "delivered_at">,
  nowSec: number,
) {
  if (j.status === "delivered" && j.delivered_at !== null) {
    const at = j.delivered_at + j.review_window
    return { kind: "auto-release" as const, at, left: Math.max(0, at + 1 - nowSec) }
  }
  if (j.status === "open" || j.status === "claimed")
    return { kind: "refund" as const, at: j.deadline, left: Math.max(0, j.deadline + 1 - nowSec) }
  return null
}

/** The line under a job in My jobs: what happens next if nobody acts (§9.4). */
export function nextLine(j: JobJson, as: "poster" | "machine", nowSec: number): string {
  const t = pendingTimeout(j, nowSec)
  if (!t) return j.status === "paid" ? "paid" : j.status
  const when = t.left > 0 ? `in ${duration(t.left)}` : "now"
  if (t.kind === "auto-release")
    return as === "poster"
      ? `your review, or auto-release ${when}`
      : `paid automatically if the poster doesn't answer ${when}`
  if (as === "poster") return `refund to you if nobody delivers ${when}`
  return j.status === "claimed" ? `deliver before the deadline ${when}` : `open, deadline ${when}`
}

/** What `/api/v1/stats` and `/api/v1/events` return, as far as the landing needs them. */
export type StatsJson = { usdc_in_escrow: string; paid_24h: string; jobs_per_hour: number[] }

const SETTLED = { paid: "paid", auto_released: "auto-released", refunded: "refunded" } as const

/**
 * The landing's live values (§11.10): real data where it exists, else null, and the page keeps its labelled example.
 * The chart and the escrow meter go live once anything settled in the last 24 h; the settlements strip once there are
 * four real settlements. The meter has no scale in the spec: it fills on a log scale up to 1,000,000 USDC (DECISIONS).
 */
export function landingLive(stats: StatsJson | null, events: EventJson[] | null) {
  const activity = stats && stats.jobs_per_hour.length === 24 && stats.jobs_per_hour.some((n) => n > 0)
  const escrow = activity ? BigInt(stats.usdc_in_escrow) : null
  const settled = (events ?? [])
    .filter((e) => e.kind in SETTLED && e.amount)
    .slice(-4)
    .reverse()
  return {
    chart: activity ? stats.jobs_per_hour : null,
    escrow: escrow === null ? null : `${formatUsdc(escrow, { decimals: 0 })} USDC`,
    meterOn: escrow === null ? null : Math.min(28, Math.round((28 * Math.log10(1 + Number(escrow) / 1e6)) / 6)),
    settlements:
      settled.length < 4
        ? null
        : settled.map((e) => ({
            k: `Job ${e.job} · ${SETTLED[e.kind as keyof typeof SETTLED]}`,
            v: `${usdc(e.amount!)} USDC → ${e.kind === "refunded" ? "poster" : shortAddress(e.actor)}`,
          })),
  }
}
