// The server's pieces, chosen from env once per process (CLAUDE.md §7.3). Locally everything has a default that
// points at the harness (`pnpm --filter @samite/local run up`); on any hosted deployment (production or a Vercel
// preview) every default is refused, so a missing secret stops the server instead of quietly running on memory, a
// constant session secret, a local folder, or a moderator that passes everything.
import "server-only"
import { join } from "node:path"
import { address, createSolanaRpc, type Address, type Rpc, type SolanaRpcApi } from "@solana/kit"
import { parseServerEnv, type ServerEnv } from "@samite/config/env"
import { createDb, type Db } from "@samite/db"
import { SAMITE_ESCROW_PROGRAM_ADDRESS, type EscrowContext } from "@samite/program-client"
import { isProduction } from "../env"
import { pgKv, upstashKv, type Kv } from "./kv"
import { anthropicModerator, localModerator, offModerator, type Moderator } from "./moderation"
import type { SessionConfig } from "./session"
import { fsStore, r2Store, type BlobStore } from "./storage"

/** The local harness's Postgres and validator (packages/local). Never used in production. */
const LOCAL = {
  db: "postgres://postgres@127.0.0.1:55473/samite",
  rpc: "http://127.0.0.1:8899",
  secret: "local-only-session-secret",
}

export type Server = {
  env: ServerEnv
  production: boolean
  db: Db
  kv: Kv
  store: BlobStore
  moderator: Moderator
  rpc: Rpc<SolanaRpcApi>
  program: Address
  escrow: EscrowContext
  /** The site's origin for sign-in checks and links; locally the request's own origin. */
  origin(req: Request): string
  session(req: Request): SessionConfig
}

function required(hosted: boolean, value: string | undefined, name: string, local: string): string {
  if (value) return value
  if (hosted) throw new Error(`${name} is not set`)
  return local
}

async function build(): Promise<Server> {
  const env = parseServerEnv(process.env)
  const production = isProduction()
  // Vercel sets VERCEL=1 on every deployment, previews included (the SIWS chain id stays tied to production)
  const hosted = production || process.env.VERCEL === "1"
  // the worker runs the migrations (it starts first and owns the index); the web app only connects
  const db = await createDb(required(hosted, env.databaseUrl, "DATABASE_URL", LOCAL.db))

  // shared by every instance: Upstash when configured, else the same Postgres (table `kv`, created by the worker's
  // migrations)
  const kv = env.upstash ? upstashKv(env.upstash) : pgKv(db)
  const secret = required(hosted, env.sessionSecret, "SESSION_SECRET", LOCAL.secret)
  const site = process.env.NEXT_PUBLIC_SITE_URL
  const origin = (req: Request) => site || (production ? "https://samite.fun" : new URL(req.url).origin)

  const r2 = env.r2
  const r2Ready = !!(r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket)
  if (hosted && !r2Ready)
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are not set")
  const store: BlobStore = r2Ready
    ? r2Store({
        accountId: r2.accountId!,
        accessKeyId: r2.accessKeyId!,
        secretAccessKey: r2.secretAccessKey!,
        bucket: r2.bucket!,
      })
    : fsStore({ dir: join(process.cwd(), "../../.data/blobs"), secret })

  const log = (l: Record<string, unknown>) => console.log(JSON.stringify(l))
  const moderator = env.anthropicApiKey
    ? anthropicModerator({ apiKey: env.anthropicApiKey, model: env.moderationModel, log })
    : hosted
      ? offModerator()
      : localModerator()

  const program = address(env.programId ?? SAMITE_ESCROW_PROGRAM_ADDRESS)
  return {
    env,
    production,
    db,
    kv,
    store,
    moderator,
    rpc: createSolanaRpc(required(hosted, env.rpcUrl, "SOLANA_RPC_URL", LOCAL.rpc)),
    program,
    escrow: { usdcMint: address(env.usdcMint), programAddress: program },
    origin,
    session: (req) => ({ db, kv, secret, origin: origin(req), chainId: production ? "mainnet" : "localnet" }),
  }
}

let cached: Promise<Server> | undefined
export function server(): Promise<Server> {
  cached ??= build().catch((e) => {
    cached = undefined // let the next request try again (e.g. the database came up)
    throw e
  })
  return cached
}
