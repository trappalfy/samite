"use client"
import { cssFontFamily, drawSamiteMark, Press, type PressOptions } from "@samite/ui/press"
import { prefersReducedMotion } from "@samite/ui/components"
import { drawHud, type HudGeometry } from "./hud"

/** The paper panel: the eye printed in ink (bayer, breathe) with the job HUD on top (§11.5, §11.6). */
export function HeroPress() {
  const options = (): PressOptions => {
    const mono = cssFontFamily("--ff-space-mono", '"Space Mono", monospace')
    const reduced = prefersReducedMotion()
    let geo: HudGeometry | null = null
    return {
      cell: window.innerWidth < 600 ? 5 : 6,
      shape: "bayer",
      schedule: "breathe",
      period: 5.2,
      ink: "#0A0A0A",
      glow: 2,
      wide: 9,
      bloom: 0.3,
      fonts: [`700 11px ${mono}`],
      source(ctx, w, h) {
        const mw = Math.min(w * 0.84, h * 0.62 * 1.27),
          mh = mw / 1.2716,
          cx = w / 2,
          cy = h * 0.4
        geo = { cx, cy, mw, mh, w, h }
        // light behind the mark: a soft sun and long faint rays, fading out toward the button
        const g = ctx.createRadialGradient(cx, cy, mw * 0.1, cx, cy, Math.max(w, h) * 0.75)
        g.addColorStop(0, "rgba(255,255,255,.30)")
        g.addColorStop(0.45, "rgba(255,255,255,.12)")
        g.addColorStop(1, "rgba(255,255,255,0)")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        ctx.save()
        ctx.translate(cx, cy)
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 + 0.1,
            len = Math.max(w, h) * (i % 2 ? 0.7 : 1)
          const rg = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len)
          rg.addColorStop(0, "rgba(255,255,255,.16)")
          rg.addColorStop(1, "rgba(255,255,255,0)")
          ctx.fillStyle = rg
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(Math.cos(a - 0.03) * len, Math.sin(a - 0.03) * len)
          ctx.lineTo(Math.cos(a + 0.03) * len, Math.sin(a + 0.03) * len)
          ctx.fill()
        }
        ctx.restore()
        ctx.fillStyle = "#fff"
        drawSamiteMark(ctx, cx - mw / 2, cy - mh / 2, mh)
        const fade = ctx.createLinearGradient(0, h * 0.66, 0, h)
        fade.addColorStop(0, "rgba(0,0,0,0)")
        fade.addColorStop(1, "rgba(0,0,0,1)")
        ctx.fillStyle = fade
        ctx.fillRect(0, h * 0.66, w, h * 0.34)
      },
      overlay(ctx, t) {
        if (geo) drawHud(ctx, t, geo, mono, reduced)
      },
    }
  }
  return <Press options={options} />
}
