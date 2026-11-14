"use client"
// The landing's live numbers (§11.10): the page renders the labelled example first (static, fast), then reads
// /api/v1/stats and /api/v1/events and swaps in real values where real data exists (`landingLive`). With ?shot or
// ?example, or if the API can't be reached (before launch it answers 404 on samite.fun), the example and its label stay.
import { useEffect, useState } from "react"
import { Ex, SegMeter } from "@samite/ui/components"
import { landingLive, type EventJson, type StatsJson } from "@/lib/view"
import { DotChart } from "./DotChart"
import s from "./landing.module.css"

type Live = ReturnType<typeof landingLive>
const NONE: Live = { chart: null, escrow: null, meterOn: null, settlements: null }

let once: Promise<Live> | undefined // one pair of requests for the whole page
function load(): Promise<Live> {
  const get = <T,>(path: string) =>
    fetch(path)
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .catch(() => null)
  once ??= Promise.all([
    get<StatsJson>("/api/v1/stats"),
    get<{ events: EventJson[] }>("/api/v1/events?limit=200"),
  ]).then(([stats, feed]) => landingLive(stats, feed?.events ?? null))
  return once
}

function useLive(): Live {
  const [live, setLive] = useState<Live>(NONE)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.has("shot") || q.has("example")) return
    let alive = true
    void load().then((l) => alive && setLive(l))
    return () => {
      alive = false
    }
  }, [])
  return live
}

const EXAMPLE_SETTLEMENTS = [
  { k: "Job 0412 · paid", v: "117.00 USDC → 7f3a…c91e" },
  { k: "Job 0415 · claimed", v: "Scrape 2,000 listings → 9be2…04aa" },
  { k: "Job 0416 · posted", v: "Label 5,000 images · 60 USDC" },
  { k: "Job 0409 · auto-released", v: "24.38 USDC → 3c1d…77f0" },
]

/** The hero's module: settlements per hour, the axis, and the escrow meter. */
export function LiveModule() {
  const live = useLive()
  const real = live.chart !== null
  return (
    <div className={s.module}>
      <DotChart
        perHour={live.chart}
        label={
          real
            ? "Jobs settled per hour over the last 24 hours"
            : "Jobs settled per hour over the last 24 hours (example)"
        }
      />
      {/* live data is the last 24 hours up to now, not a calendar day */}
      <div className={`${s.axis} ${s.mono}`}>
        {(real ? ["−24h", "−18h", "−12h", "−6h", "now"] : ["00:00", "06:00", "12:00", "18:00", "24:00"]).map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className={s.meter}>
        <div className={`${s.row} ${s.mono}`}>
          <span>Escrow locked</span>
          <b>{live.escrow ?? "48,210 USDC"}</b>
        </div>
        <SegMeter on={live.meterOn ?? 19} className={s.meterSeg} />
        {real ? null : (
          <div className={s.row} style={{ marginTop: 10 }}>
            <Ex>example values; live from /api/v1/stats in production</Ex>
          </div>
        )}
      </div>
    </div>
  )
}

/** "Latest settlements": the last four real ones once there are four, else the labelled example. */
export function LiveSettlements() {
  const live = useLive()
  const cells = live.settlements ?? EXAMPLE_SETTLEMENTS
  return (
    <>
      <div className={s.lbl}>
        <span className={s.mono} style={{ fontSize: 12 }}>
          Latest settlements
        </span>
        {live.settlements ? null : <Ex />}
      </div>
      {cells.map((x) => (
        <div key={x.k}>
          <div className={`${s.k} ${s.mono}`}>{x.k}</div>
          <div className={s.v}>{x.v}</div>
        </div>
      ))}
    </>
  )
}
