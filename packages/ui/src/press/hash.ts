/** 4×4 ordered-dither thresholds. */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)

/** Per-cell hash in [0, 1]; integer maths identical to the reference. */
export const hash = (i: number, j: number, s: number) => {
  let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
