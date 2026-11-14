/** `?shot&t=<seconds>` freezes every press at t (CLAUDE.md §13). Returns null when not in shot mode. */
export function readShot(search: string): number | null {
  const q = new URLSearchParams(search)
  if (!q.has("shot")) return null
  const t = Number(q.get("t"))
  return Number.isFinite(t) && t > 0 ? t : 0
}
