import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, signBytes } from "@solana/kit"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDb, type Db } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import { ApiError } from "../../lib/server/errors"
import { memoryKv } from "../../lib/server/kv"
import { authenticate, openSession, signInChallenge, signInText, type SessionConfig } from "../../lib/server/session"

let db: Db
let t = Date.parse("2026-11-12T12:00:00Z")
const now = () => t
const cfg = (): SessionConfig => ({
  db,
  kv,
  secret: "test-secret",
  origin: "https://samite.fun",
  chainId: "mainnet",
  now,
})
const kv = memoryKv(now)
beforeAll(async () => {
  db = await createDb("memory://")
  await migrate(db)
})
afterAll(async () => db.$client.close?.())

async function wallet(seed = 3) {
  const k = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(seed))
  return {
    address: await getAddressFromPublicKey(k.publicKey),
    sign: async (text: string) =>
      Buffer.from(await signBytes(k.privateKey, new TextEncoder().encode(text))).toString("base64"),
  }
}
async function signIn(
  o: { seed?: number; edit?: (text: string) => string; challenge?: Awaited<ReturnType<typeof signInChallenge>> } = {},
) {
  const w = await wallet(o.seed)
  const ch = o.challenge ?? (await signInChallenge(cfg()))
  const text = (o.edit ?? ((x) => x))(signInText(ch, w.address))
  return {
    w,
    ch,
    body: { address: w.address, signedMessage: Buffer.from(text).toString("base64"), signature: await w.sign(text) },
  }
}
const why = async (p: Promise<unknown>) => {
  try {
    await p
    return "ok"
  } catch (e) {
    return e instanceof ApiError ? `${e.code}: ${e.message}` : String(e)
  }
}

describe("Sign-In With Solana", () => {
  it("opens a session that authenticates the browser's requests", async () => {
    const { w, body } = await signIn()
    const s = await openSession(cfg(), body)
    expect(s.address).toBe(w.address)
    const req = new Request("https://samite.fun/api/v1/jobs/1/delivery", {
      headers: { cookie: `samite_session=${s.cookie}` },
    })
    expect(await authenticate(req, new Uint8Array(), cfg())).toEqual({ address: w.address, via: "session" })
  })

  it("never stores the session token itself", async () => {
    const { body } = await signIn()
    const s = await openSession(cfg(), body)
    const { schema } = await import("@samite/db")
    const rows = await db.select().from(schema.sessions)
    expect(rows.some((r) => r.id === s.cookie)).toBe(false)
  })

  it("refuses a message for another site, another address, another chain, or a bad signature", async () => {
    expect(
      await why(
        openSession(cfg(), (await signIn({ edit: (x) => x.replace("samite.fun wants", "evil.example wants") })).body),
      ),
    ).toMatch(/made for evil.example/)
    const other = await wallet(9)
    const a = await signIn()
    expect(await why(openSession(cfg(), { ...a.body, address: other.address }))).toMatch(/address doesn't match/)
    expect(
      await why(
        openSession(cfg(), (await signIn({ edit: (x) => x.replace("Chain ID: mainnet", "Chain ID: devnet") })).body),
      ),
    ).toMatch(/devnet/)
    const b = await signIn()
    expect(await why(openSession(cfg(), { ...b.body, signature: await other.sign("x") }))).toMatch(
      /signature doesn't match/,
    )
  })

  it("spends each nonce once, and refuses one it never issued", async () => {
    const { body } = await signIn()
    expect(await why(openSession(cfg(), body))).toBe("ok")
    expect(await why(openSession(cfg(), body))).toMatch(/already used or never issued/)
    const ch = await signInChallenge(cfg())
    expect(await why(openSession(cfg(), (await signIn({ challenge: { ...ch, nonce: "f".repeat(32) } })).body))).toMatch(
      /never issued/,
    )
  })

  it("refuses an expired sign-in", async () => {
    const { body } = await signIn()
    t += 601_000
    expect(await why(openSession(cfg(), body))).toMatch(/expired/)
  })

  it("only lets a session change state from this site (CSRF)", async () => {
    const { body } = await signIn()
    const s = await openSession(cfg(), body)
    const post = (origin: string | null) =>
      new Request("https://samite.fun/api/v1/specs", {
        method: "POST",
        headers: { cookie: `samite_session=${s.cookie}`, ...(origin ? { origin } : {}) },
        body: "{}",
      })
    expect(await why(authenticate(post("https://evil.example"), new Uint8Array(), cfg()))).toMatch(/^forbidden/)
    expect(await why(authenticate(post(null), new Uint8Array(), cfg()))).toMatch(/^forbidden/)
    expect(await why(authenticate(post("https://samite.fun"), new Uint8Array(), cfg()))).toBe("ok")
  })

  it("ends with its expiry", async () => {
    const { body } = await signIn()
    const s = await openSession(cfg(), body)
    t += 7 * 86_400_000 + 1
    const req = new Request("https://samite.fun/api/v1/me", { headers: { cookie: `samite_session=${s.cookie}` } })
    expect(await why(authenticate(req, new Uint8Array(), cfg()))).toMatch(/^session_invalid/)
  })
})
