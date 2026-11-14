"use client"
import { drawSamiteMark, MARK_ASPECT, Press, SAMITE_MARK, type PressOptions } from "@samite/ui/press"

export type StepKind = "post" | "claim" | "deliver" | "paid"

// The eye inside the mark, in the mark's own units (samite-mark.js): the almond and the pupil.
const EYE = { x: 517.4, y: 497, a: 82, b: 42, r: 25 }

/** An almond as wide as the mark's eye, `open` (0–1) of its full height. */
function almond(ctx: CanvasRenderingContext2D, open: number, grow = 1) {
  const { x, y } = EYE,
    a = EYE.a * grow,
    b = EYE.b * grow * open
  ctx.beginPath()
  ctx.moveTo(x - a, y)
  ctx.quadraticCurveTo(x, y - 2 * b, x + a, y)
  ctx.quadraticCurveTo(x, y + 2 * b, x - a, y)
  ctx.closePath()
}

/**
 * The four steps as the Samite eye in four states (the owner's choice, Nov 13), like the hero's job tracker:
 * posted, the eye is shut; claimed, it opens and a tracking box locks on; delivered, it is open with a ringed pupil;
 * paid, the pupil fills. Static prints (§11.5), with the fading rule that leads to the next step.
 */
export function StepGlyph({ kind }: { kind: StepKind }) {
  const options = (): PressOptions => ({
    cell: 3,
    shape: "bayer",
    schedule: "still",
    glow: 1,
    wide: 3,
    bloom: 0.2,
    intro: 0,
    source(ctx, w, h) {
      // room above and below the mark for the tracking box's corners
      // as tall as the canvas allows (on phones, as wide as the cell allows)
      const H = Math.min(h - 30, (w - 32) / MARK_ASPECT),
        s = H / SAMITE_MARK.vb[3],
        x0 = 16,
        y0 = (h - H) / 2
      ctx.fillStyle = "#fff"
      const width = drawSamiteMark(ctx, x0, y0, H)

      // the eye, in the mark's units
      ctx.save()
      ctx.translate(x0 - SAMITE_MARK.vb[0] * s, y0 - SAMITE_MARK.vb[1] * s)
      ctx.scale(s, s)
      const px = 1 / s // one CSS px in mark units
      const { x, y, r } = EYE
      // every state draws its own eye: first close the mark's
      ctx.fillStyle = "#fff"
      almond(ctx, 1, 1.1)
      ctx.fill()

      if (kind === "post") {
        // shut: the lid's seam and three lashes, cut out of the ink
        ctx.strokeStyle = "#000"
        ctx.lineCap = "butt"
        ctx.lineWidth = 9 * px
        ctx.beginPath()
        ctx.moveTo(x - EYE.a * 1.05, y - 6)
        ctx.quadraticCurveTo(x, y + EYE.b * 1.3, x + EYE.a * 1.05, y - 6)
        ctx.stroke()
        ctx.lineWidth = 5 * px
        for (const t of [-0.5, 0, 0.5]) {
          // on the seam (a quadratic with its control mid-way, so x is linear in its parameter u)
          const u = (t + 1.05) / 2.1,
            lx = x + t * EYE.a,
            ly = y - 6 + 2 * u * (1 - u) * (EYE.b * 1.3 + 6)
          ctx.beginPath()
          ctx.moveTo(lx, ly)
          ctx.lineTo(lx + t * 7 * px, ly + 9 * px)
          ctx.stroke()
        }
      } else {
        const open = kind === "claim" ? 0.72 : 1
        ctx.fillStyle = "#000"
        almond(ctx, open, 1.1)
        ctx.fill()
        ctx.save()
        almond(ctx, open, 1.1)
        ctx.clip()
        ctx.fillStyle = "#fff"
        ctx.strokeStyle = "#fff"
        if (kind === "deliver") {
          // a hollow pupil: the delivery is in, not yet paid
          ctx.lineWidth = 6 * px
          ctx.beginPath()
          ctx.arc(x, y, r * 1.3, 0, Math.PI * 2)
          ctx.stroke()
        } else {
          // claimed: a pupil under a half-open lid; paid: the full pupil
          ctx.beginPath()
          ctx.arc(x, y, r * (kind === "paid" ? 1.45 : 0.95), 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
      ctx.restore()

      if (kind === "claim") {
        // the tracking box around the mark, as on the hero's tracker
        const pad = 9,
          L = x0 - pad,
          T = y0 - pad,
          R = x0 + width + pad,
          B = y0 + H + pad,
          arm = 20,
          t = 5
        ctx.fillStyle = "#fff"
        for (const [cx, cy, dx, dy] of [
          [L, T, 1, 1],
          [R, T, -1, 1],
          [R, B, -1, -1],
          [L, B, 1, -1],
        ] as const) {
          ctx.fillRect(dx > 0 ? cx : cx - arm, dy > 0 ? cy : cy - t, arm, t)
          ctx.fillRect(dx > 0 ? cx : cx - t, dy > 0 ? cy : cy - arm, t, arm)
        }
      }

      // the rule that leads on to the next step, where there is room for it
      const from = x0 + width + 22
      if (w - from < 40) return
      const g = ctx.createLinearGradient(from, 0, w, 0)
      g.addColorStop(0, "rgba(255,255,255,.5)")
      g.addColorStop(1, "rgba(255,255,255,0)")
      ctx.fillStyle = g
      ctx.fillRect(from, h / 2 - 3, w, 6)
    },
  })
  return <Press options={options} />
}
