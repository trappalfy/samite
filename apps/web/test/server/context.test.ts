// Hosted deployments never run on local defaults (review R4): on Vercel, production or preview, a missing secret stops
// the server instead of quietly using memory, a constant session secret, a local folder, or a moderator that passes
// everything. Locally (no VERCEL) the harness defaults stay.
import { afterEach, describe, expect, it, vi } from "vitest"

const KEYS = ["VERCEL", "VERCEL_ENV", "SAMITE_FORCE_PRODUCTION", "DATABASE_URL", "SESSION_SECRET", "SOLANA_RPC_URL"]
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of KEYS)
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  vi.resetModules()
})

async function build(env: Record<string, string>) {
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, env)
  vi.resetModules()
  const { server } = await import("../../lib/server/context")
  return server()
}

describe("the server's pieces on a hosted deployment", () => {
  it("refuse local defaults on a Vercel preview", async () => {
    await expect(build({ VERCEL: "1", VERCEL_ENV: "preview" })).rejects.toThrow("DATABASE_URL is not set")
  })

  it("refuse local defaults in production", async () => {
    await expect(build({ VERCEL: "1", VERCEL_ENV: "production" })).rejects.toThrow("DATABASE_URL is not set")
  })

  it("use the harness defaults locally", async () => {
    const s = await build({ DATABASE_URL: "memory://" })
    expect(s.store.kind).toBe("fs")
    expect(s.production).toBe(false)
    await s.db.$client.close?.()
  })
})
