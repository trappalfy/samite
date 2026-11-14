import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fetchToken } from "@solana-program/token"
import { fetchConfig, findConfigPda } from "@samite/program-client"
import { LIMITS, USDC_MINT } from "@samite/config/solana"
import { bootstrap, localClient, startValidator, stopValidator, usdcAccount, type Client } from "../src"

// Runs a real solana-test-validator (local only). `pnpm --filter @samite/local test:int`
describe("local validator harness", () => {
  let client: Client
  let signers: Awaited<ReturnType<typeof bootstrap>>
  let started = false
  beforeAll(async () => {
    started = await startValidator() // reuses a running one (pnpm --filter @samite/local run up)
    client = localClient()
    signers = await bootstrap(client)
  }, 120_000)
  afterAll(() => {
    if (started) stopValidator() // never stop a validator someone else is using
  })

  it("initialises the config with the launch values", async () => {
    const [config] = await findConfigPda()
    const c = (await fetchConfig(client.rpc, config)).data
    expect(c.admin).toBe(signers.authority.address)
    expect(c.usdcMint).toBe(USDC_MINT)
    expect(c.treasury).toBe(await usdcAccount(signers.treasury.address))
    expect(c.feeBps).toBe(LIMITS.feeBps)
    expect(c.minReward).toBe(LIMITS.minRewardBaseUnits)
    expect(c.paused).toBe(false)
  })

  it("funds the poster with local USDC", async () => {
    const t = await fetchToken(client.rpc, await usdcAccount(signers.poster.address))
    expect(t.data.amount).toBe(10_000_000_000n)
    expect(t.data.mint).toBe(USDC_MINT)
  })

  it("is idempotent: bootstrapping again keeps the config", async () => {
    await bootstrap(client)
    const [config] = await findConfigPda()
    expect((await fetchConfig(client.rpc, config)).data.feeBps).toBe(250)
    expect((await fetchToken(client.rpc, await usdcAccount(signers.poster.address))).data.amount).toBe(10_000_000_000n)
  }, 60_000)
})
