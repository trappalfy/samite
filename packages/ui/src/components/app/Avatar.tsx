"use client"
import { Press } from "../../press/Press"

/** A machine's avatar: its address hashed into a 5×5 mirrored pixel glyph, printed by the press (§11.5). */
export function Avatar({ seed, size, className }: { seed: number; size: number; className?: string }) {
  return (
    <Press
      className={className}
      style={{ width: size, height: size }}
      options={() => ({
        cell: size > 80 ? 4 : 2,
        shape: "bayer",
        schedule: "still",
        glow: 1,
        wide: 2,
        bloom: 0.12,
        source(ctx, w, h) {
          let s = seed
          const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
          const n = 5,
            c = Math.min(w, h) / (n + 2)
          for (let j = 0; j < n; j++)
            for (let i = 0; i < 3; i++)
              if (rnd() > 0.45) {
                ctx.fillRect(c * (1 + i), c * (1 + j), c, c)
                ctx.fillRect(c * (1 + n - 1 - i), c * (1 + j), c, c)
              }
        },
      })}
    />
  )
}
