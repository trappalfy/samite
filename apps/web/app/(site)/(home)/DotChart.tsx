"use client"
import { useEffect, useRef } from "react"

/**
 * Jobs settled per hour over 24 h as a vertical dot waveform: `perHour` (24 values, oldest first) when live, else the
 * deterministic example shape.
 */
export function DotChart({ label, perHour }: { label: string; perHour?: number[] | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const draw = () => {
      const r = c.getBoundingClientRect(),
        dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = r.width * dpr
      c.height = r.height * dpr
      const x = c.getContext("2d")!
      x.scale(dpr, dpr)
      const cols = Math.floor((r.width - 32) / 6),
        mid = r.height / 2
      const max = perHour ? Math.max(1, ...perHour) : 1
      for (let i = 0; i < cols; i++) {
        const t = i / cols,
          base = perHour
            ? perHour[Math.min(23, Math.floor(t * 24))]! / max
            : 0.25 + 0.55 * Math.exp(-Math.pow((t - 0.55) / 0.2, 2)) + 0.12 * Math.sin(i * 1.7) * Math.sin(i * 0.31)
        // a quiet hour keeps one dim dot, so the baseline stays visible
        const n = perHour && base === 0 ? 0 : Math.max(1, Math.round(base * 10))
        for (let k = -n; k <= n; k++) {
          const a = n === 0 ? 0 : 1 - Math.abs(k) / (n + 1)
          x.fillStyle = `rgba(242,239,232,${0.25 + 0.75 * a})`
          x.fillRect(16 + i * 6, mid + k * 5.5 - 1, 2, 2)
        }
      }
    }
    draw()
    window.addEventListener("resize", draw)
    return () => window.removeEventListener("resize", draw)
  }, [perHour])
  return <canvas ref={ref} role="img" aria-label={label} />
}
