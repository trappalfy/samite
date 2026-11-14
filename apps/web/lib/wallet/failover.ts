// A transport for @solana/kit that tries each RPC in turn. The browser's own key (NEXT_PUBLIC_RPC_URL) can refuse
// (its domain rule, a revoked key) or be rate-limited; then the same request goes to the next one, and nobody sees an
// error for it. Only transport failures move on (HTTP errors, the network): a JSON-RPC error is an answer, and is
// the same everywhere.
import type { RpcTransport } from "@solana/kit"

type Options = {
  /** Called once per failure of an RPC, with its position in the list. */
  onFail?: (index: number, error: unknown) => void
  /** How long an RPC that failed is skipped (it would only fail again first); 60 s. */
  coolDownMs?: number
  now?: () => number
}

export function failover(transports: readonly RpcTransport[], o: Options = {}): RpcTransport {
  const coolDown = o.coolDownMs ?? 60_000
  const now = o.now ?? Date.now
  const failedAt = transports.map(() => -Infinity)
  const transport = async (config: Parameters<RpcTransport>[0]) => {
    let last: unknown
    const fresh = transports.map((_, i) => now() - failedAt[i]! >= coolDown)
    // the RPCs not cooling down, in order; if every one is, all of them, in order
    const order = transports.map((_, i) => i).filter((i) => fresh[i])
    for (const i of order.length ? order : transports.map((_, j) => j)) {
      try {
        return await transports[i]!(config)
      } catch (e) {
        if (config.signal?.aborted) throw e
        failedAt[i] = now()
        o.onFail?.(i, e)
        last = e
      }
    }
    throw last
  }
  return transport as RpcTransport
}
