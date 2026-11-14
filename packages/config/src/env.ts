import { z } from "zod"
import { USDC_MINT } from "./solana"

// Empty strings in .env mean "not set".
const blank = (v: unknown) => (v === "" ? undefined : v)
const optUrl = z.preprocess(blank, z.url().optional())
const optStr = z.preprocess(blank, z.string().optional())

const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: optUrl,
  NEXT_PUBLIC_RPC_URL: optUrl,
  NEXT_PUBLIC_PROGRAM_ID: optStr,
  NEXT_PUBLIC_TOKEN_CA: optStr,
  NEXT_PUBLIC_TOKEN_TICKER: optStr,
})

const serverSchema = z.object({
  SOLANA_RPC_URL: optUrl,
  RPC_WEBHOOK_SECRET: optStr,
  SAMITE_PROGRAM_ID: optStr,
  USDC_MINT: z.preprocess(blank, z.string().default(USDC_MINT)),
  KEEPER_SECRET: optStr,
  KEEPER_ENABLED: optStr,
  DATABASE_URL: optStr,
  // Upstash's REST client takes a URL and a token (§7.3 had a single REDIS_URL; see DECISIONS "M3 — server pieces")
  UPSTASH_REDIS_REST_URL: optUrl,
  UPSTASH_REDIS_REST_TOKEN: optStr,
  R2_ACCOUNT_ID: optStr,
  R2_ACCESS_KEY_ID: optStr,
  R2_SECRET_ACCESS_KEY: optStr,
  R2_BUCKET: optStr,
  SESSION_SECRET: optStr,
  ANTHROPIC_API_KEY: optStr,
  MODERATION_MODEL: optStr,
})

type Env = Record<string, string | undefined>

export type PublicEnv = {
  siteUrl: string | undefined
  rpcUrl: string | undefined
  programId: string | undefined
  tokenCa: string | undefined
  tokenTicker: string | undefined
}

export function parsePublicEnv(env: Env): PublicEnv {
  const e = publicSchema.parse(env)
  return {
    siteUrl: e.NEXT_PUBLIC_SITE_URL,
    rpcUrl: e.NEXT_PUBLIC_RPC_URL,
    programId: e.NEXT_PUBLIC_PROGRAM_ID,
    tokenCa: e.NEXT_PUBLIC_TOKEN_CA,
    tokenTicker: e.NEXT_PUBLIC_TOKEN_TICKER,
  }
}

export type ServerEnv = {
  rpcUrl: string | undefined
  rpcWebhookSecret: string | undefined
  programId: string | undefined
  usdcMint: string
  keeperSecret: string | undefined
  /** Off unless the owner sets exactly "true" (CLAUDE.md §7.2). */
  keeperEnabled: boolean
  databaseUrl: string | undefined
  upstash: { url: string; token: string } | undefined
  r2: { accountId?: string; accessKeyId?: string; secretAccessKey?: string; bucket?: string }
  sessionSecret: string | undefined
  anthropicApiKey: string | undefined
  moderationModel: string | undefined
}

export function parseServerEnv(env: Env): ServerEnv {
  const e = serverSchema.parse(env)
  return {
    rpcUrl: e.SOLANA_RPC_URL,
    rpcWebhookSecret: e.RPC_WEBHOOK_SECRET,
    programId: e.SAMITE_PROGRAM_ID,
    usdcMint: e.USDC_MINT,
    keeperSecret: e.KEEPER_SECRET,
    keeperEnabled: e.KEEPER_ENABLED === "true",
    databaseUrl: e.DATABASE_URL,
    upstash:
      e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN
        ? { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN }
        : undefined,
    r2: {
      accountId: e.R2_ACCOUNT_ID,
      accessKeyId: e.R2_ACCESS_KEY_ID,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY,
      bucket: e.R2_BUCKET,
    },
    sessionSecret: e.SESSION_SECRET,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    moderationModel: e.MODERATION_MODEL,
  }
}
