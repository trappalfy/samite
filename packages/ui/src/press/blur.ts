import { clamp } from "./schedule"

/** Separable box blur, 3 passes ≈ gaussian; r in cells. One to one with the reference. */
export function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice()
  const a = src.slice(),
    b = new Float32Array(src.length)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      // horizontal
      let acc = 0
      const o = y * w
      for (let x = -r; x <= r; x++) acc += a[o + clamp(x, 0, w - 1)]!
      for (let x = 0; x < w; x++) {
        b[o + x] = acc / (2 * r + 1)
        acc += a[o + clamp(x + r + 1, 0, w - 1)]! - a[o + clamp(x - r, 0, w - 1)]!
      }
    }
    for (let x = 0; x < w; x++) {
      // vertical
      let acc = 0
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, h - 1) * w + x]!
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1)
        acc += b[clamp(y + r + 1, 0, h - 1) * w + x]! - b[clamp(y - r, 0, h - 1) * w + x]!
      }
    }
  }
  return a
}
