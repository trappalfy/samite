// Pure helpers for the activity grid (usable on the server).

/** The prototype's example counts (deterministic). */
export function exampleCounts(): number[] {
  const out: number[] = []
  for (let x = 0; x < 26; x++)
    for (let y = 0; y < 7; y++) {
      const r = (((x * 7 + y) * 2654435761) >>> 0) % 1000 / 1000,
        ramp = 0.25 + 0.6 * (x / 26)
      out.push(r < ramp * 0.55 ? (r < ramp * 0.12 ? 3 : r < ramp * 0.3 ? 2 : 1) : 0)
    }
  return out
}
