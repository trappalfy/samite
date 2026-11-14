// The press: Samite's print engine (CLAUDE.md §11.5).
// Draws any white-on-black source as a screen of dots, squares or ordered-dither pixels and animates it with a
// deterministic schedule. A pure function of t: seek(t) draws exactly that frame.
// Ported one to one from design/prototype/samite-press.js; the per-cell maths below must not drift from it
// (the Playwright parity test compares pixels against the reference engine).
import { blur } from "./blur"
import { BAYER, hash } from "./hash"
import { breatheAt, clamp, cycleAt, smooth, STILL, type Params } from "./schedule"

export const INK = "#F2EFE8"

export type PressShape = "dot" | "square" | "bayer"
export type PressSchedule = "cycle" | "breathe" | "still"

export type PressApi = {
  readonly width: number
  readonly height: number
  readonly cell: number
  /** Source brightness 0..1 at a point in CSS px. */
  sample(x: number, y: number): number
  params(t: number): Params
}

export type PressOptions = {
  /** Draw white on black, in CSS px. */
  source: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  cell?: number
  shape?: PressShape
  schedule?: PressSchedule
  period?: number
  ink?: string
  gamma?: number
  glow?: number
  wide?: number
  bloom?: number
  intro?: number
  seed?: number
  overlay?: (ctx: CanvasRenderingContext2D, t: number, api: PressApi) => void
  /** CSS font shorthands the source draws with (e.g. `italic 800 100px "Montserrat"`); layout waits for them. */
  fonts?: string[]
  /** Shot mode: start() only draws this frame (CLAUDE.md §13). */
  frozenAt?: number | null
}

export type PressHandle = {
  layout(): void
  draw(t: number): void
  seek(t: number): void
  start(): void
  stop(): void
  destroy(): void
  readonly api: PressApi
}

const MAX_CELLS = 25_000
const FRAME_BUDGET_MS = 4

export function createPress(canvas: HTMLCanvasElement, opts: PressOptions): PressHandle {
  const o = {
    cell: 9,
    shape: "dot" as PressShape,
    schedule: "cycle" as PressSchedule,
    period: 6.4,
    ink: INK,
    gamma: 0.9,
    glow: 2,
    wide: 6,
    intro: 1.2,
    seed: 7,
    bloom: 1,
    ...stripUndefined(opts),
    source: opts.source,
  }
  const ctx = canvas.getContext("2d")!
  let W = 0,
    H = 0,
    dpr = 1,
    cols = 0,
    rows = 0,
    S: Float32Array | null = null,
    G: Float32Array = new Float32Array(0),
    Wd: Float32Array = new Float32Array(0),
    raf = 0,
    t0 = 0,
    running = false,
    tNow = 0,
    destroyed = false,
    visible = true
  const off = document.createElement("canvas"),
    octx = off.getContext("2d", { willReadFrequently: true })!
  const reducedMq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null
  const reduced = () => reducedMq?.matches === true

  function layout() {
    if (destroyed) return
    const r = canvas.getBoundingClientRect()
    W = Math.max(1, r.width)
    H = Math.max(1, r.height)
    dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    cols = Math.ceil(W / o.cell)
    rows = Math.ceil(H / o.cell)
    if (cols * rows > MAX_CELLS) console.warn(`[press] ${cols * rows} cells, over the ${MAX_CELLS} budget`)
    // draw the source at full size, then average it down to one value per cell
    off.width = Math.round(W)
    off.height = Math.round(H)
    octx.setTransform(1, 0, 0, 1, 0, 0)
    octx.fillStyle = "#000"
    octx.fillRect(0, 0, off.width, off.height)
    octx.fillStyle = "#fff"
    octx.strokeStyle = "#fff"
    o.source(octx, off.width, off.height)
    const small = document.createElement("canvas")
    small.width = cols
    small.height = rows
    const sctx = small.getContext("2d", { willReadFrequently: true })!
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = "high"
    sctx.drawImage(off, 0, 0, cols * o.cell, rows * o.cell, 0, 0, cols, rows)
    const px = sctx.getImageData(0, 0, cols, rows).data
    S = new Float32Array(cols * rows)
    for (let i = 0; i < S.length; i++) S[i] = px[i * 4]! / 255
    G = blur(S, cols, rows, o.glow)
    Wd = blur(S, cols, rows, o.wide)
    draw(tNow)
  }

  function params(t: number): Params {
    if (o.schedule === "still" || reduced()) return { ...STILL }
    if (o.schedule === "breathe") return breatheAt(t, o.period)
    return cycleAt((t % o.period) / o.period)
  }

  function draw(t: number) {
    tNow = t
    if (!S) return
    const p = Object.assign({}, params(t))
    p.b *= o.bloom
    p.c *= o.bloom
    // the print comes up from nothing on load (not under reduced motion: that's motion too)
    const intro = o.intro > 0 && o.schedule !== "still" && !reduced() ? smooth(0, o.intro, t) : 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = o.ink
    ctx.beginPath()
    const c = o.cell,
      half = c / 2,
      seedT = Math.floor(t * 12)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        let L = (p.a * S[k]! + p.b * G[k]! + p.c * Wd[k]!) * p.gain * intro - p.th
        if (L <= 0.02) continue
        L = Math.pow(Math.min(L, 1.35), o.gamma)
        let x = i * c + half,
          y = j * c + half
        if (p.sc > 0.01) {
          const h1 = hash(i, j, o.seed),
            h2 = hash(i, j, o.seed + 1),
            h3 = hash(i, j, seedT)
          if (h3 < p.sc * 0.55) continue // flicker out
          x += (h1 - 0.5) * p.sc * c * 5
          y += (h2 - 0.5) * p.sc * c * 3 - p.sc * c * 1.5
        }
        if (o.shape === "dot") {
          const r = half * 1.12 * Math.sqrt(L)
          ctx.moveTo(x + r, y)
          ctx.arc(x, y, r, 0, 6.2832)
        } else if (o.shape === "square") {
          const s = c * 0.92 * Math.sqrt(Math.min(L, 1))
          ctx.rect(x - s / 2, y - s / 2, s, s)
        } else if (L > BAYER[(j & 3) * 4 + (i & 3)]!) {
          // bayer: on/off pixels, density = brightness
          const s = c * 0.82
          ctx.rect(x - s / 2, y - s / 2, s, s)
        }
      }
    }
    ctx.fill()
    if (o.overlay) o.overlay(ctx, t, api)
  }

  const api: PressApi = {
    get width() {
      return W
    },
    get height() {
      return H
    },
    get cell() {
      return o.cell
    },
    sample(x: number, y: number) {
      if (!S) return 0
      const i = clamp(Math.floor(x / o.cell), 0, cols - 1),
        j = clamp(Math.floor(y / o.cell), 0, rows - 1)
      return S[j * cols + i]!
    },
    params,
  }

  // frame budget: if a press averages over 4 ms per frame, it drops to 30 fps (and says so once)
  let avg = 0,
    frames = 0,
    halfRate = false,
    lastDraw = 0
  function frame(now: number) {
    if (!running) return
    if (!halfRate || now - lastDraw >= 33) {
      const a = performance.now()
      draw(Math.max(0, (now - t0) / 1000))
      const ms = performance.now() - a
      lastDraw = now
      avg = frames === 0 ? ms : avg * 0.9 + ms * 0.1
      if (++frames > 60 && !halfRate && avg > FRAME_BUDGET_MS) {
        halfRate = true
        console.info(`[press] ${avg.toFixed(1)} ms/frame over the ${FRAME_BUDGET_MS} ms budget; 30 fps`)
      }
    }
    raf = requestAnimationFrame(frame)
  }

  function start() {
    if (destroyed) return
    if (o.frozenAt != null) {
      draw(o.frozenAt)
      return
    }
    if (o.schedule === "still" || reduced()) {
      draw(tNow)
      return
    }
    if (running) return
    running = true
    t0 = performance.now() - tNow * 1000
    raf = requestAnimationFrame(frame)
  }
  function stop() {
    running = false
    cancelAnimationFrame(raf)
  }

  // pause offscreen and in hidden tabs
  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((es) =>
          es.forEach((e) => {
            visible = e.isIntersecting
            if (visible && !document.hidden) start()
            else stop()
          }),
        )
      : null
  io?.observe(canvas)
  const onVisibility = () => (document.hidden ? stop() : visible && start())
  document.addEventListener("visibilitychange", onVisibility)
  let rt: ReturnType<typeof setTimeout> | undefined
  const onResize = () => {
    clearTimeout(rt)
    rt = setTimeout(layout, 120)
  }
  window.addEventListener("resize", onResize)
  const onMotion = () => {
    stop()
    if (visible && !document.hidden) start()
  }
  reducedMq?.addEventListener("change", onMotion)

  if (o.fonts?.length && document.fonts) {
    // load() of a family list rejects as soon as one face fails (next/font's local("Arial") fallback, absent on
    // Linux and Android) while the real face is still downloading; ready resolves once nothing is pending
    Promise.allSettled(o.fonts.map((f) => document.fonts.load(f)))
      .then(() => document.fonts.ready)
      .then(() => layout())
  } else {
    if (document.fonts) document.fonts.ready.then(layout)
    layout()
  }

  return {
    layout,
    draw,
    api,
    seek(t: number) {
      draw(t)
    },
    start,
    stop,
    destroy() {
      stop()
      destroyed = true
      io?.disconnect()
      clearTimeout(rt)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("resize", onResize)
      reducedMq?.removeEventListener("change", onMotion)
    },
  }
}

function stripUndefined<T extends object>(v: T): Partial<T> {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<T>
}
