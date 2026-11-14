"use client"
import type { ReactNode } from "react"
import s from "./app.module.css"

/** Category chips: toggle buttons (aria-pressed). */
export function Chips<T extends string>({ options, value, onChange, label }: { options: T[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: "contents" }}>
      {options.map((o) => (
        <button key={o} type="button" className={s.chip} aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** Segmented control (sort; Anyone / People / Machines). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: T[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className={s.seg} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** One-of-three option cards (deliverable kind, who can claim): a radio group. */
export function Options<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; title: string; hint: ReactNode }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className={s.opts} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={s.opt}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return
            e.preventDefault()
            const n = options[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]!
            onChange(n.value)
            ;(e.currentTarget.parentElement?.children[options.indexOf(n)] as HTMLElement | undefined)?.focus()
          }}
        >
          <b>{o.title}</b>
          <span>{o.hint}</span>
        </button>
      ))}
    </div>
  )
}
