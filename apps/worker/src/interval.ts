// How often the indexer asks the RPC for new transactions. Each idle check is one RPC call (1 credit at Helius), so
// 2 s is about 1.3M calls a month: more than Helius's free plan (1M credits). INDEXER_POLL_MS trades freshness for
// cost, e.g. 5000 while the site is closed. At most 20 s: /health reports the indexer stale after 30 s without a sync.
export const DEFAULT_POLL_MS = 2_000
export const MIN_POLL_MS = 1_000
export const MAX_POLL_MS = 20_000

export function indexerPollMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_POLL_MS
  const ms = Number(value)
  if (!Number.isInteger(ms) || ms < MIN_POLL_MS || ms > MAX_POLL_MS)
    throw new Error(`INDEXER_POLL_MS must be a whole number of milliseconds from ${MIN_POLL_MS} to ${MAX_POLL_MS}`)
  return ms
}
