// apps/worker: the indexer (always), the hourly deletion of delivered files past their retention (always), and the
// keeper (only with KEEPER_ENABLED=true), plus GET /health. JSON logs; never logs secrets. Env: CLAUDE.md §7.3
// (DATABASE_URL, SOLANA_RPC_URL, SAMITE_PROGRAM_ID, USDC_MINT, KEEPER_ENABLED, KEEPER_SECRET, and the R2_* storage
// keys, the same as the web app's), INDEXER_POLL_MS (src/interval.ts) and PORT for the health check.
import { createServer } from "node:http"
import { join } from "node:path"
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getBase58Encoder,
} from "@solana/kit"
import { lte } from "drizzle-orm"
import { parseServerEnv } from "@samite/config/env"
import { createDb, schema } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import { SAMITE_ESCROW_PROGRAM_ADDRESS } from "@samite/program-client"
import { fsStore, r2Store } from "@samite/storage"
import { syncOnce } from "./indexer/sync"
import { rpcChain } from "./keeper/chain"
import { keeperTick } from "./keeper/keeper"
import { indexerPollMs } from "./interval"
import { purgeDeliveries } from "./purge"
import { wsUrlFor } from "./ws"

const log = (line: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...line }))
const env = parseServerEnv(process.env)
if (!env.databaseUrl || !env.rpcUrl) {
  log({ msg: "DATABASE_URL and SOLANA_RPC_URL are required" })
  process.exit(1)
}

let pollMs: number
try {
  pollMs = indexerPollMs(process.env.INDEXER_POLL_MS)
} catch (e) {
  log({ msg: e instanceof Error ? e.message : String(e) })
  process.exit(1)
}

const db = await createDb(env.databaseUrl)
await migrate(db)
const program = address(env.programId ?? SAMITE_ESCROW_PROGRAM_ADDRESS)
const rpc = createSolanaRpc(env.rpcUrl)
const state = { lastSync: 0, lastError: "" as string, keeper: false }

async function every(ms: number, name: string, fn: () => Promise<unknown>) {
  for (;;) {
    try {
      await fn()
      state.lastError = ""
    } catch (e) {
      state.lastError = `${name}: ${e instanceof Error ? e.message : String(e)}`
      log({ msg: "error", where: name, error: state.lastError })
    }
    await new Promise((r) => setTimeout(r, ms))
  }
}

void every(pollMs, "indexer", async () => {
  await syncOnce(db, rpc, { program, log })
  state.lastSync = Date.now()
})

// the same store as the web app: R2 when its four keys are set, else the local folder the web app uses
const r2 = env.r2
const store =
  r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket
    ? r2Store({
        accountId: r2.accountId,
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
        bucket: r2.bucket,
      })
    : fsStore({ dir: join(process.cwd(), "../../.data/blobs"), secret: env.sessionSecret ?? "local" })
log({ msg: "file deletion on", store: store.kind })
void every(3_600_000, "purge", () => purgeDeliveries(db, store, { log }))
// the web app's short-lived rows (replay keys, sign-in nonces, rate counters: apps/web/lib/server/kv.ts) once expired,
// every minute: rate counters hold IP addresses, and the privacy page says they're gone within two minutes
void every(60_000, "kv", () => db.delete(schema.kv).where(lte(schema.kv.expiresAt, new Date())))

if (env.keeperEnabled && env.keeperSecret) {
  const signer = await createKeyPairSignerFromBytes(getBase58Encoder().encode(env.keeperSecret))
  const chain = rpcChain({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(wsUrlFor(env.rpcUrl)),
    signer,
    programAddress: program,
  })
  state.keeper = true
  log({ msg: "keeper on", keeper: signer.address })
  void every(60_000, "keeper", () =>
    keeperTick({ db, chain, ctx: { usdcMint: address(env.usdcMint), programAddress: program }, log }),
  )
} else log({ msg: "keeper off", reason: env.keeperEnabled ? "KEEPER_SECRET is empty" : "KEEPER_ENABLED is not true" })

const port = Number(process.env.PORT ?? 8787)
createServer(async (req, res) => {
  if (req.url !== "/health") return void res.writeHead(404).end()
  const [cursor] = await db.select().from(schema.indexerState)
  const fresh = Date.now() - state.lastSync < 30_000
  res.writeHead(fresh ? 200 : 503, { "content-type": "application/json" })
  res.end(
    JSON.stringify({
      ok: fresh,
      lastSlot: cursor?.lastSlot?.toString() ?? null,
      keeper: state.keeper,
      // where the last error happened, not its message (that is in the log): this endpoint may be reachable
      error: state.lastError ? state.lastError.split(":")[0] : null,
    }),
  )
}).listen(port, () => log({ msg: "worker up", port, program, pollMs }))
