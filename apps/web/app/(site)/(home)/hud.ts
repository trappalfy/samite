// The hero HUD (CLAUDE.md §11.6): the job tracker drawn in ink on the paper panel, a pure function of t.
// Ported from hud() in design/prototype/landing.html.
import { formatUsdc, splitReward } from "@samite/config/money"

/** Example jobs only (the panel is captioned "example job, time sped up"). */
const JOBS = [
  { id: "0417", reward: 120_000_000n, worker: "7f3a…c91e", hash: "9be2…04aa" },
  { id: "0418", reward: 40_000_000n, worker: "3c1d…77f0", hash: "e51a…b2c3" },
  { id: "0419", reward: 260_000_000n, worker: "a90f…1d4e", hash: "07cd…9f12" },
] as const

/** Seconds per state. */
export const STAGE = 1.9
const INK = "#0A0A0A"

export type HudState = { state: 0 | 1 | 2 | 3; job: (typeof JOBS)[number]; u: number; lines: string[] }

export function hudState(t: number, opts: { reduced?: boolean } = {}): HudState {
  // reduced motion: no movement, the PAID frame of the first job, fully drawn
  const k = opts.reduced ? 3 : Math.floor(Math.max(0, t) / STAGE)
  const u = opts.reduced ? 1 : (Math.max(0, t) % STAGE) / STAGE
  const state = (k % 4) as HudState["state"]
  const job = JOBS[Math.floor(k / 4) % JOBS.length]!
  const lines = [
    [`JOB ${job.id}`, `${formatUsdc(job.reward)} USDC`, "OPEN"],
    [`JOB ${job.id}`, "CLAIMED", `BY ${job.worker}`],
    [`JOB ${job.id}`, "DELIVERED", `HASH ${job.hash}`],
    [`JOB ${job.id}`, `PAID ${formatUsdc(splitReward(job.reward, 250).toMachine)}`, `→ ${job.worker}`],
  ][state]!
  return { state, job, u, lines }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export type HudGeometry = { cx: number; cy: number; mw: number; mh: number; w: number; h: number }

/** Draws the tracking box, ring and label for time t. `mono` is the Space Mono family list. */
export function drawHud(ctx: CanvasRenderingContext2D, t: number, geo: HudGeometry, mono: string, reduced: boolean) {
  const { cx, cy, mw, mh } = geo
  const anchors = [
    { x: cx, y: cy, s: mw * 0.17 }, // pupil
    { x: cx + mw * 0.31, y: cy - mh * 0.35, s: mw * 0.11 }, // upper-right ray
    { x: cx - mw * 0.36, y: cy + mh * 0.27, s: mw * 0.11 }, // lower-left ray
    { x: cx, y: cy, s: mw * 0.17 }, // pupil again: paid
  ]
  const { state: st, u, lines } = hudState(t, { reduced })
  const prev = anchors[(st + 3) % 4]!,
    cur = anchors[st]!,
    m = ease(Math.min(1, u / 0.22))
  const x = prev.x + (cur.x - prev.x) * m,
    y = prev.y + (cur.y - prev.y) * m,
    s = prev.s + (cur.s - prev.s) * m
  ctx.save()
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = 1.5
  // big ring on the pupil while the job is open or paid
  if (st === 0 || st === 3) {
    ctx.globalAlpha = Math.min(1, u * 4)
    ctx.beginPath()
    ctx.arc(cx, cy, mw * 0.26, 0, 6.2832)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // the tracking box
  ctx.strokeRect(x - s / 2, y - s / 2, s, s)
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    ctx.fillRect(x + (a * s) / 2 - 2, y + (b * s) / 2 - 2, 4, 4)
  if (st === 3) {
    const f = s * 0.34 // paid: the pupil fills
    ctx.fillRect(x - f / 2, y - f / 2, f, f)
  } else ctx.fillRect(x - 3, y - 3, 6, 6)
  // label on a cream plate with a hairline leader; flips left when it would leave the panel
  ctx.font = `700 11px ${mono}`
  ctx.textBaseline = "top"
  const lx = x + s / 2 + 10,
    ly = y - s / 2
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14
  const left = lx + w > geo.w - 8
  const bx = left ? x - s / 2 - 10 - w : lx
  ctx.globalAlpha = Math.min(1, (u - 0.18) * 6)
  ctx.fillStyle = "rgba(242,239,232,.92)"
  ctx.fillRect(bx, ly, w, lines.length * 15 + 10)
  ctx.fillStyle = INK
  lines.forEach((l, i) => ctx.fillText(l, bx + 7, ly + 6 + i * 15))
  ctx.beginPath()
  ctx.moveTo(left ? x - s / 2 : x + s / 2, y - s / 2)
  ctx.lineTo(left ? bx + w : bx, ly)
  ctx.stroke()
  ctx.restore()
}
