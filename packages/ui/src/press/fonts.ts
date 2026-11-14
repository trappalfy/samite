/**
 * The real font family behind a CSS variable set by next/font (its family names are hashed),
 * for use in canvas `ctx.font`. Falls back when the variable is missing.
 */
export function cssFontFamily(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return v || fallback
}
