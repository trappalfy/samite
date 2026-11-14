/** The RPC's websocket URL: same host over ws(s); a local test validator listens one port up (8899 → 8900). */
export function wsUrlFor(rpcUrl: string): string {
  const u = new URL(rpcUrl)
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
  if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port) u.port = String(Number(u.port) + 1)
  return u.toString()
}
