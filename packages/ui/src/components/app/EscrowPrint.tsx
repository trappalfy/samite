"use client"
import { Press } from "../../press/Press"

/** "Escrow, last 24 h" as a printed landscape (bayer, still). `level(t)` gives 0..1 for t in 0..1. */
export function EscrowPrint({ className, level }: { className?: string; level?: (t: number) => number }) {
  return (
    <Press
      className={className}
      options={() => ({
        cell: 4,
        shape: "bayer",
        schedule: "still",
        glow: 2,
        wide: 6,
        source(ctx, w, h) {
          const f = level ?? ((t: number) => 0.35 + 0.35 * Math.exp(-Math.pow((t - 0.62) / 0.2, 2)) + 0.06 * Math.sin(t * 40) * Math.sin(t * 7))
          ctx.beginPath()
          ctx.moveTo(0, h)
          for (let x = 0; x <= w; x += 4) ctx.lineTo(x, h - f(x / w) * h)
          ctx.lineTo(w, h)
          ctx.closePath()
          ctx.fill()
        },
      })}
    />
  )
}
