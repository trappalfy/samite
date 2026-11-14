// WCAG 2.x contrast for the design tokens (CLAUDE.md §11.2, §13).

export type RGBA = { r: number; g: number; b: number; a: number }

/** Parses #rgb, #rrggbb and rgba()/rgb() into 0..255 channels and 0..1 alpha. */
export function parseColor(s: string): RGBA {
  const v = s.trim().toLowerCase()
  if (v.startsWith("#")) {
    const h = v.length === 4 ? [...v.slice(1)].map((c) => c + c).join("") : v.slice(1)
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (!m) throw new Error(`unsupported colour: ${s}`)
  const [r, g, b, a = 1] = m[1]!.split(",").map((x) => Number(x.trim()))
  return { r: r!, g: g!, b: b!, a }
}

const lin = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const luminance = ({ r, g, b }: RGBA) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

/** Contrast of `fg` over an opaque `bg` (a translucent fg is composited first). */
export function contrast(fg: RGBA, bg: RGBA): number {
  const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 }
  const [hi, lo] = [luminance(f), luminance(bg)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
