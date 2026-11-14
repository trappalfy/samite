// The press schedules (CLAUDE.md §11.5). Ported one to one from design/prototype/samite-press.js:
// same keyframes, same smoothstep, same float operations in the same order.

/** Weights for one frame: sharp, glow, wide, gain, threshold, scatter. */
export type Params = { a: number; b: number; c: number; gain: number; th: number; sc: number }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

// keyframes of the 'cycle' schedule (phase 0..1)
export const CYCLE: ReadonlyArray<readonly [number, Params]> = [
  [0.0, { a: 1, b: 0.3, c: 0, gain: 1.7, th: 0.02, sc: 0 }], // ink: crisp letters, a fringe of small dots
  [0.16, { a: 1, b: 0.3, c: 0, gain: 1.7, th: 0.02, sc: 0 }],
  [0.3, { a: 0.8, b: 0.9, c: 0.55, gain: 1.35, th: 0.04, sc: 0 }], // bloom: glow spreads into big dots
  [0.4, { a: 0.8, b: 0.9, c: 0.55, gain: 1.2, th: 0.04, sc: 0 }],
  [0.5, { a: 0.6, b: 0.8, c: 0.5, gain: 0.5, th: 0, sc: 0 }], // dim: dots shrink to a faint screen
  [0.58, { a: 0.8, b: 0.5, c: 0.2, gain: 1.1, th: 0.05, sc: 0.85 }], // scatter: dots fly off and drop out
  [0.66, { a: 1, b: 0.45, c: 0, gain: 2.4, th: 0.22, sc: 0 }], // blob: chunky merged dots, an outline look
  [0.8, { a: 1, b: 0.45, c: 0, gain: 2.4, th: 0.22, sc: 0 }],
  [0.92, { a: 1, b: 0.3, c: 0, gain: 1.7, th: 0.02, sc: 0 }],
  [1.0, { a: 1, b: 0.3, c: 0, gain: 1.7, th: 0.02, sc: 0 }],
]

const KEYS = ["a", "b", "c", "gain", "th", "sc"] as const

export function cycleAt(p: number): Params {
  for (let k = 1; k < CYCLE.length; k++) {
    const [p1, v1] = CYCLE[k]!
    const [p0, v0] = CYCLE[k - 1]!
    if (p <= p1) {
      const u = smooth(p0, p1, p)
      const o = {} as Params
      for (const key of KEYS) o[key] = v0[key] + (v1[key] - v0[key]) * u
      return o
    }
  }
  return CYCLE[0]![1]
}

export function breatheAt(t: number, period: number): Params {
  const s = Math.sin((t / period) * Math.PI * 2),
    s2 = Math.sin((t / (period * 1.7)) * Math.PI * 2 + 1.3)
  return { a: 1, b: 0.55 + 0.25 * s, c: 0.35 + 0.2 * s2, gain: 1.25 + 0.12 * s, th: 0.03, sc: 0 }
}

/** 'still' and prefers-reduced-motion. */
export const STILL: Readonly<Params> = { a: 1, b: 0.45, c: 0.25, gain: 1.4, th: 0.03, sc: 0 }
