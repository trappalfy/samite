import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, getBase58Decoder, signBytes } from "@solana/kit"
import { describe, expect, it } from "vitest"
import { formatAuthorization, requestMessage } from "@samite/formats"
import { ApiError, errorResponse } from "../../lib/server/errors"
import { memoryKv } from "../../lib/server/kv"
import { verifySignedRequest } from "../../lib/server/signed"

// §6.1: Authorization: Samite-Ed25519 address, ts, sig over samite:v1\n<METHOD>\n<path?query>\n<ts>\n<hex sha256(body)>
const NOW = 1_800_000_000
const clock = () => NOW * 1000
const keys = (seed: number) => createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(seed))

async function signed(
  o: {
    seed?: number
    method?: string
    url?: string
    body?: string
    ts?: number
    tamper?: (r: { url: string; body: string; method: string }) => void
  } = {},
) {
  const k = await keys(o.seed ?? 7)
  const address = await getAddressFromPublicKey(k.publicKey)
  const r = {
    method: o.method ?? "POST",
    url: o.url ?? "https://samite.fun/api/v1/specs?dry=1",
    body: o.body ?? '{"v":"samite/job@1"}',
  }
  const ts = o.ts ?? NOW
  const u = new URL(r.url)
  const msg = requestMessage({
    method: r.method,
    pathAndQuery: u.pathname + u.search,
    ts,
    body: new TextEncoder().encode(r.body),
  })
  const sig = getBase58Decoder().decode(await signBytes(k.privateKey, new TextEncoder().encode(msg)))
  o.tamper?.(r)
  const req = new Request(r.url, {
    method: r.method,
    headers: { authorization: formatAuthorization({ address, ts, sig }) },
    body: r.method === "GET" ? undefined : r.body,
  })
  return { req, body: new TextEncoder().encode(r.body), address }
}

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "ok"
  } catch (e) {
    return e instanceof ApiError ? e.code : String(e)
  }
}

describe("verifySignedRequest", () => {
  it("returns the signer's address for a good request", async () => {
    const { req, body, address } = await signed()
    expect(await verifySignedRequest(req, body, { kv: memoryKv(clock), now: clock })).toBe(address)
  })

  it("refuses a request whose body, path, query or method changed after signing", async () => {
    const cases: ((r: { url: string; body: string; method: string }) => void)[] = [
      (r) => (r.body = '{"v":"samite/job@2"}'),
      (r) => (r.url = "https://samite.fun/api/v1/specs?dry=0"),
      (r) => (r.url = "https://samite.fun/api/v1/specz?dry=1"),
      (r) => (r.method = "PUT"),
    ]
    for (const tamper of cases) {
      const { req, body } = await signed({ tamper })
      expect(await code(verifySignedRequest(req, body, { kv: memoryKv(clock), now: clock }))).toBe("auth_bad_signature")
    }
  })

  it("refuses a signature by another key for the claimed address", async () => {
    const a = await signed({ seed: 7 })
    const b = await signed({ seed: 8 })
    const forged = new Request(a.req.url, {
      method: "POST",
      headers: {
        authorization: a.req.headers
          .get("authorization")!
          .replace(/sig=\S+/, b.req.headers.get("authorization")!.match(/sig=\S+/)![0]),
      },
      body: '{"v":"samite/job@1"}',
    })
    expect(await code(verifySignedRequest(forged, a.body, { kv: memoryKv(clock), now: clock }))).toBe(
      "auth_bad_signature",
    )
  })

  it("accepts a clock 60 s off either way, and not 61", async () => {
    for (const [ts, want] of [
      [NOW - 60, "ok"],
      [NOW + 60, "ok"],
      [NOW - 61, "auth_clock_skew"],
      [NOW + 61, "auth_clock_skew"],
    ] as const) {
      const { req, body } = await signed({ ts })
      expect(await code(verifySignedRequest(req, body, { kv: memoryKv(clock), now: clock })), `ts ${ts - NOW}`).toBe(
        want,
      )
    }
  })

  it("refuses the same signed request twice within 2 minutes, and lets it go after", async () => {
    let t = clock()
    const now = () => t
    const kv = memoryKv(now)
    const { req, body } = await signed()
    expect(await code(verifySignedRequest(req.clone(), body, { kv, now }))).toBe("ok")
    expect(await code(verifySignedRequest(req.clone(), body, { kv, now }))).toBe("auth_replayed")
    t += 59_000 // still inside the skew window, still remembered
    expect(await code(verifySignedRequest(req.clone(), body, { kv, now }))).toBe("auth_replayed")
    t += 62_000 // past 2 minutes the skew check refuses it anyway
    expect(await code(verifySignedRequest(req.clone(), body, { kv, now }))).toBe("auth_clock_skew")
  })

  it("says what's wrong with a missing or malformed header", async () => {
    const kv = memoryKv(clock)
    expect(
      await code(
        verifySignedRequest(new Request("https://samite.fun/api/v1/specs"), new Uint8Array(), { kv, now: clock }),
      ),
    ).toBe("auth_missing")
    const bad = new Request("https://samite.fun/x", {
      headers: { authorization: "Samite-Ed25519 address=abc, ts=1, sig=2" },
    })
    expect(await code(verifySignedRequest(bad, new Uint8Array(), { kv, now: clock }))).toBe("auth_malformed")
  })
})

describe("error responses", () => {
  it("carry a stable code and a message, and hide unexpected errors", async () => {
    const r = errorResponse(new ApiError("rate_limited", "Too many requests.", undefined, { "retry-after": "30" }))
    expect(r.status).toBe(429)
    expect(r.headers.get("retry-after")).toBe("30")
    expect(await r.json()).toEqual({ error: { code: "rate_limited", message: "Too many requests." } })
    const hidden = errorResponse(new Error("db password is hunter2"))
    expect(hidden.status).toBe(500)
    expect(JSON.stringify(await hidden.json())).not.toContain("hunter2")
  })
})

describe("the errors page", () => {
  it("lists exactly the codes the API can return, with their HTTP status", async () => {
    const { readFileSync } = await import("node:fs")
    const { ERROR_STATUS } = await import("../../lib/server/errors")
    const page = readFileSync(new URL("../../app/(site)/(app)/docs/errors/page.mdx", import.meta.url), "utf8")
    const rows = Object.fromEntries(
      [...page.matchAll(/^\| `([a-z_]+)`\s*\| (\d{3})\s*\|/gm)].map((m) => [m[1], Number(m[2])]),
    )
    expect(rows).toEqual(ERROR_STATUS)
  })
})
