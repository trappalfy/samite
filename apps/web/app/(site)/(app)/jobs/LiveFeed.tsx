"use client"
// The live feed (§6.1, §11.12): the latest events, then new ones as the indexer sees them (SSE).
import { useEffect, useState } from "react"
import { Feed } from "@samite/ui/app"
import { feedItem, type EventJson } from "@/lib/view"

/**
 * `now` is the server's time when it rendered the page (unix seconds). The first render uses it on both sides, so the
 * browser's hydration prints the same "12s" as the server did; after that the feed's clock runs on from it by the
 * browser's timer, never by the browser's own clock, which may be off.
 */
export function LiveFeed({ initial, cursor, now: rendered }: { initial: EventJson[]; cursor: number; now: number }) {
  const [events, setEvents] = useState(initial)
  const [now, setNow] = useState(rendered)
  useEffect(() => {
    const es = new EventSource(`/api/v1/events/stream?cursor=${cursor}`)
    const add = (m: MessageEvent<string>) => setEvents((prev) => [...prev, JSON.parse(m.data) as EventJson].slice(-8))
    for (const k of [
      "posted",
      "claimed",
      "unclaimed",
      "claim_expired",
      "delivered",
      "rejected",
      "paid",
      "auto_released",
      "refunded",
      "cancelled",
    ])
      es.addEventListener(k, add as EventListener)
    const start = performance.now()
    const t = setInterval(() => setNow(rendered + Math.floor((performance.now() - start) / 1000)), 10_000)
    return () => {
      es.close()
      clearInterval(t)
    }
  }, [cursor, rendered])
  if (!events.length) return <p className="dim">Nothing yet. New jobs, claims and payouts show here as they happen.</p>
  return <Feed items={[...events].reverse().map((e) => feedItem(e, now))} />
}
