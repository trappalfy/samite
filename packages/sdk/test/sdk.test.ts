import {
  createKeyPairSignerFromPrivateKeyBytes,
  getPublicKeyFromAddress,
  signatureBytes,
  getBase58Encoder,
  verifySignature,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit"
import { describe, expect, it } from "vitest"
import { parseAuthorization, requestMessage } from "@samite/formats"
import { createSamite, SamiteError, siteFetch } from "../src"

// No network: a fake API and a fake RPC. The RPC knows no job account, so the SDK falls back to the API's hash.
const rpc = {
  getAccountInfo: () => ({ send: async () => ({ context: { slot: 1n }, value: null }) }),
} as unknown as Rpc<SolanaRpcApi>
const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(5))
const PDA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"

function fakeApi(specBytes: string, claimedHash: string) {
  const calls: Request[] = []
  const fetch: typeof globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const req = new Request(url, init)
    calls.push(req)
    const path = new URL(req.url).pathname
    if (path.endsWith("/spec.json")) return new Response(specBytes)
    if (path.startsWith("/api/v1/jobs/"))
      return Response.json({
        job: { no: "0001", pda: PDA, status: "open", spec_hash: claimedHash },
        spec: null,
        events: [],
        rejections: [],
      })
    return Response.json({ ok: true })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

describe("jobs.get", () => {
  it("refuses a spec that doesn't hash to the job's spec_hash", async () => {
    const api = fakeApi('{"title":"something else"}', "a".repeat(64))
    const samite = createSamite({ api: "https://samite.test", rpc, signer, fetch: api.fetch })
    await expect(samite.jobs.get("0001")).rejects.toMatchObject({ code: "hash_mismatch" })
  })

  it("accepts the exact bytes whose sha256 is the job's spec_hash", async () => {
    const bytes = '{"v":"samite/job@1"}'
    const { createHash } = await import("node:crypto")
    const api = fakeApi(bytes, createHash("sha256").update(bytes).digest("hex"))
    const samite = createSamite({ api: "https://samite.test", rpc, signer, fetch: api.fetch })
    expect((await samite.jobs.get("0001")).specVerified).toBe(true)
  })
})

describe("signed requests", () => {
  it("sign exactly the method, path, query, time and body with the machine's key (§6.1)", async () => {
    const api = fakeApi("", "")
    const samite = createSamite({ api: "https://samite.test", rpc, signer, fetch: api.fetch })
    await samite.request("POST", "/api/v1/specs?x=1", { spec: { a: 1 } })
    const req = api.calls[0]!
    const auth = parseAuthorization(req.headers.get("authorization"))!
    expect(auth.address).toBe(signer.address)
    const body = new Uint8Array(await req.arrayBuffer())
    const msg = new TextEncoder().encode(
      requestMessage({ method: "POST", pathAndQuery: "/api/v1/specs?x=1", ts: auth.ts, body }),
    )
    expect(
      await verifySignature(
        await getPublicKeyFromAddress(signer.address),
        signatureBytes(getBase58Encoder().encode(auth.sig)),
        msg,
      ),
    ).toBe(true)
  })

  it("turn API errors into errors with the stable code", async () => {
    const fetch = (async () =>
      Response.json(
        { error: { code: "rate_limited", message: "Too many requests." } },
        { status: 429 },
      )) as unknown as typeof globalThis.fetch
    const samite = createSamite({ api: "https://samite.test", rpc, signer, fetch })
    const e = await samite.request("GET", "/api/v1/jobs").catch((x: unknown) => x)
    expect(e).toBeInstanceOf(SamiteError)
    expect(e).toMatchObject({ code: "rate_limited" })
  })
})

describe("deliveries never carry a private key (a spec is untrusted, §6.3)", () => {
  it("refuses a keypair file, or a key pasted into the text or note, before anything leaves the machine", async () => {
    const { getBase58Decoder } = await import("@solana/kit")
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { generateKeyPairSync } = await import("node:crypto")
    // a real key pair in the CLI's format: 32 secret bytes, then the 32-byte public key
    const k = generateKeyPairSync("ed25519")
    const secret = k.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32)
    const pub = k.publicKey.export({ format: "der", type: "spki" }).subarray(-32)
    const pair = Uint8Array.from([...secret, ...pub])
    const dir = mkdtempSync(join(tmpdir(), "samite-sdk-"))
    const keyFile = join(dir, "notes.json")
    writeFileSync(keyFile, JSON.stringify([...pair]))
    const api = fakeApi("", "")
    const samite = createSamite({ api: "https://samite.test", rpc, signer, fetch: api.fetch })
    try {
      await expect(samite.deliveries.submit("0001", { files: [keyFile] })).rejects.toMatchObject({ code: "secret_key" })
      const b58 = getBase58Decoder().decode(pair)
      await expect(samite.deliveries.submit("0001", { text: `here: ${b58}` })).rejects.toMatchObject({
        code: "secret_key",
      })
      await expect(
        samite.deliveries.submit("0001", { text: "ok", note: JSON.stringify([...pair]) }),
      ).rejects.toMatchObject({ code: "secret_key" })
      expect(api.calls).toHaveLength(0) // nothing was sent anywhere
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    // 64 bytes that aren't a key pair (a transaction signature is one) don't trip it
    const sig = getBase58Decoder().decode(new Uint8Array(64).fill(7))
    const { containsSecretKey } = await import("../src")
    expect(await containsSecretKey(`tx ${sig}`)).toBe(false)
    expect(await containsSecretKey(JSON.stringify(Array(64).fill(0)))).toBe(false)
  })
})

describe("the access key before launch", () => {
  it("goes to the site, as x-samite-access, and nowhere else", async () => {
    const seen: Record<string, string | null> = {}
    const base = (async (url: string | URL, init?: RequestInit) => {
      seen[String(url)] = new Headers(init?.headers).get("x-samite-access")
      return new Response("{}")
    }) as typeof globalThis.fetch
    const http = siteFetch(base, "https://samite.test", "k".repeat(40))
    await http("https://samite.test/api/v1/session")
    await http("https://bucket.r2.cloudflarestorage.com/deliveries/x?X-Amz-Signature=y", { method: "PUT" })
    await http("https://samite.test.evil.example/api/v1/session")
    expect(seen).toEqual({
      "https://samite.test/api/v1/session": "k".repeat(40),
      "https://bucket.r2.cloudflarestorage.com/deliveries/x?X-Amz-Signature=y": null,
      "https://samite.test.evil.example/api/v1/session": null,
    })
    expect(siteFetch(base, "https://samite.test", undefined)).toBe(base) // no key: the plain fetch
  })
})
