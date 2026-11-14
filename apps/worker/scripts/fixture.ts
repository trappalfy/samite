// A recorded local session: the RPC responses the indexer reads, saved as JSON (bigints kept exact as {"$n": "…"}).
export type SessionFixture = {
  program: string
  /** getSignaturesForAddress(program), newest first, exactly as the RPC returned it. */
  signatures: { signature: string; slot: bigint; err: unknown; blockTime: bigint | null }[]
  /** getTransaction(sig, { encoding: "json", maxSupportedTransactionVersion: 0 }) per signature. */
  transactions: Record<string, unknown>
  /** What the API would have stored before each post (POST /specs), keyed by spec hash hex. */
  specs: {
    hex: string
    canonicalBase64: string
    title: string
    category: string
    verdict: "pass" | "refuse"
    postedFrom: "app" | "api"
  }[]
  /** What the API would have stored before each delivery and rejection, by job address. */
  deliveries: { job: string; attempt: number; worker: string; hex: string }[]
  rejections: { job: string; attempt: number; reason: string; hex: string }[]
  /** The script's own notes: which address is which, and what each job went through. */
  notes: Record<string, string>
}

export const stringify = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? { $n: x.toString() } : x), 2) + "\n"

export const parse = <T>(s: string): T =>
  JSON.parse(s, (_k, x) =>
    x && typeof x === "object" && typeof x.$n === "string" && Object.keys(x).length === 1 ? BigInt(x.$n) : x,
  )
