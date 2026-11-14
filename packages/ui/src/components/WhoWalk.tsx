"use client"
import { Fragment, useEffect, useState } from "react"
import { prefersReducedMotion, useShot } from "./motion"
import s from "./site.module.css"

const STEP = 2.4 // seconds per item (§11.8)

/** "Agents / Bots / Devices" with a cream highlight stepping along the list. */
export function WhoWalk({ items, className }: { items: string[]; className?: string }) {
  const shot = useShot()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (shot !== null || prefersReducedMotion()) return
    const id = setInterval(() => setTick((k) => k + 1), STEP * 1000)
    return () => clearInterval(id)
  }, [shot])
  const on = (shot !== null ? Math.floor(shot / STEP) : tick) % items.length
  return (
    <div className={[s.who, className].filter(Boolean).join(" ")}>
      {items.map((it, i) => (
        <Fragment key={it}>
          {i > 0 && <span aria-hidden="true">/</span>}
          <span className={i === on ? s.whoOn : undefined}>{it}</span>
        </Fragment>
      ))}
    </div>
  )
}
