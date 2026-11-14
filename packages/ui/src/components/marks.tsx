import type { ReactNode } from "react"
import s from "./marks.module.css"

/** Labels any value that is not live from the chain (CLAUDE.md §0). */
export function Ex({ children = "example", className, block }: { children?: ReactNode; className?: string; block?: boolean }) {
  const cls = [s.ex, className].filter(Boolean).join(" ")
  return block ? <div className={cls}>{children}</div> : <span className={cls}>{children}</span>
}

export type GlyphKind = "open" | "claimed" | "delivered" | "paid" | "refunded" | "crossed"

/** 11 px status square. Always followed by its label: the shape alone never carries meaning. */
export function Glyph({ kind, className }: { kind: GlyphKind; className?: string }) {
  return <i aria-hidden="true" className={[s.g, kind !== "open" && s[kind], className].filter(Boolean).join(" ")} />
}

/** 97.5 / 2.5 payout split with its legend. */
export function SplitBar({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className={s.split} aria-hidden="true">
        <i />
        <i />
      </div>
      <div className={s.legend}>
        <span>Machine 97.5%</span>
        <span>Samite 2.5%</span>
      </div>
    </div>
  )
}

/** Segmented meter: `on` of `total` segments filled. */
export function SegMeter({ on, total = 28, className }: { on: number; total?: number; className?: string }) {
  return (
    <div className={[s.seg, className].filter(Boolean).join(" ")} style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < on ? s.on : undefined} />
      ))}
    </div>
  )
}

// the TRACE-style 6×6 pixel cluster above "Work. Transact. Earn." (a = cream, b = grey, . = empty)
const CLUSTER = [".a.b..", "aab.a.", ".aaa.b", "b.aaa.", ".a.ba.", "..b..a"]

export function PixelCluster({ className }: { className?: string }) {
  return (
    <div className={[s.pix, className].filter(Boolean).join(" ")} aria-hidden="true">
      {CLUSTER.join("").split("").map((c, i) => (
        <i key={i} className={c === "a" ? s.a : c === "b" ? s.b : undefined} />
      ))}
    </div>
  )
}
