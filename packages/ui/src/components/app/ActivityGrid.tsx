"use client"
import { useEffect, useRef } from "react"

/**
 * 26 weeks × 7 days; a day is a halftone dot whose size is its count of accepted jobs (0 = a 1.2 px line-hi dot).
 * A plain canvas, not a press: it stays crisp (§11.5). `counts` is 182 values, oldest first.
 */
export function ActivityGrid({ counts, label, className }: { counts: number[]; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const draw = () => {
      const w = cv.clientWidth,
        h = cv.clientHeight,
        d = Math.min(2, window.devicePixelRatio || 1)
      if (!w) return
      cv.width = w * d
      cv.height = h * d
      const g = cv.getContext("2d")!
      g.setTransform(d, 0, 0, d, 0, 0)
      g.clearRect(0, 0, w, h)
      const n = 26,
        s = Math.min(w / n, h / 7)
      for (let x = 0; x < n; x++)
        for (let y = 0; y < 7; y++) {
          const c = counts[x * 7 + y] ?? 0
          g.fillStyle = c ? "#F2EFE8" : "#3B3A36"
          g.beginPath()
          g.arc(x * s + s / 2, y * s + s / 2, c ? s * (0.18 + 0.1 * Math.min(3, c)) : 1.2, 0, 6.2832)
          g.fill()
        }
    }
    draw()
    window.addEventListener("resize", draw)
    return () => window.removeEventListener("resize", draw)
  }, [counts])
  return <canvas ref={ref} role="img" aria-label={label} className={className} />
}
