// The HTTP API (§6.1) end to end on the local validator: a poster and a machine, each signing requests and
// transactions with their own key, through every route of the post → claim → deliver → accept flow. The index is an
// in-memory database fed by the real indexer between steps. Needs `pnpm --filter @samite/local run up`.
import { createHash } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  address,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  generateKeyPairSigner,
  getTransactionEncoder,
  lamports,
  signBytes,
  signTransaction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit"
import { formatAuthorization, requestMessage } from "@samite/formats"
import { isUp, loadSigners, localClient, usdcAccount } from "@samite/local"
import { fetchJob, JOB_ACCOUNT_BYTES, SAMITE_ESCROW_PROGRAM_ADDRESS } from "@samite/program-client"
import { syncOnce } from "@samite/worker"

process.env.DATABASE_URL = "memory://"
process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899"
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000"

const ORIGIN = "http://localhost:3000"
type Signers = Awaited<ReturnType<typeof loadSigners>>
let k: Signers
let routes: Record<string, Record<string, (req: Request, ctx?: { params?: Promise<unknown> }) => Promise<Response>>>
let s: Awaited<ReturnType<typeof import("../lib/server/context").server>>
const client = localClient()

beforeAll(async () => {
  if (!(await isUp())) throw new Error("start the local harness first: pnpm --filter @samite/local run up")
  k = await loadSigners()
  s = await (await import("../lib/server/context")).server()
  await (await import("@samite/db/migrate")).migrate(s.db) // the worker migrates in a real run; here the index is in memory
  routes = {
    specs: await import("../app/api/v1/specs/route"),
    tx: await import("../app/api/v1/tx/[action]/route"),
    jobs: await import("../app/api/v1/jobs/route"),
    job: await import("../app/api/v1/jobs/[ref]/route"),
    spec: await import("../app/api/v1/jobs/[ref]/spec.json/route"),
    delivery: await import("../app/api/v1/jobs/[ref]/delivery/route"),
    upload: await import("../app/api/v1/deliveries/upload/route"),
    deliveries: await import("../app/api/v1/deliveries/route"),
    blobs: await import("../app/api/v1/blobs/[...key]/route"),
    machine: await import("../app/api/v1/machines/[address]/route"),
    events: await import("../app/api/v1/events/route"),
    stats: await import("../app/api/v1/stats/route"),
  } as never
})
afterAll(async () => s?.db.$client.close?.())

const lastSigned = new Map<string, number>()
/**
 * A request signed like a machine signs it (§6.1). Ed25519 is deterministic, so the same request signed twice in one
 * second is a replay (the server refuses it); like the SDK, wait for the next second instead.
 */
async function signed(who: KeyPairSigner, method: string, path: string, body?: unknown) {
  const bytes = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body))
  const id = `${who.address} ${method} ${path} ${JSON.stringify(body ?? null)}`
  let ts = Math.floor(Date.now() / 1000)
  if (lastSigned.get(id) === ts) {
    await new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 5))
    ts = Math.floor(Date.now() / 1000)
  }
  lastSigned.set(id, ts)
  const msg = new TextEncoder().encode(requestMessage({ method, pathAndQuery: path, ts, body: bytes }))
  const sig = getBase58Decoder().decode(await signBytes(who.keyPair.privateKey, msg))
  return new Request(ORIGIN + path, {
    method,
    headers: {
      authorization: formatAuthorization({ address: who.address, ts, sig }),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : bytes,
  })
}
const params = <T>(p: T) => ({ params: Promise.resolve(p) })
const call = async (r: Promise<Response> | Response) => {
  const res = await r
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test reads deep into JSON responses
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

/** Signs an unsigned /tx/* transaction locally, relays it through /tx/send, waits for it, then runs the indexer. */
async function signAndSend(who: KeyPairSigner, base64: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64))
  const signedTx = await signTransaction([who.keyPair], tx)
  const wire = getBase64Decoder().decode(getTransactionEncoder().encode(signedTx))
  const sent = await call(
    routes.tx!.POST!(
      new Request(`${ORIGIN}/api/v1/tx/send`, { method: "POST", body: JSON.stringify({ transaction: wire }) }),
      params({ action: "send" }),
    ),
  )
  expect(sent.status, JSON.stringify(sent.body)).toBe(200)
  for (let i = 0; i < 60; i++) {
    const { value } = await client.rpc.getSignatureStatuses([sent.body.signature as Signature]).send()
    if (value[0]?.err) throw new Error(`failed on-chain: ${JSON.stringify(value[0].err)}`)
    if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") break
    await new Promise((r) => setTimeout(r, 250))
  }
  await syncOnce(s.db, s.rpc, { program: SAMITE_ESCROW_PROGRAM_ADDRESS })
  return sent.body.signature as string
}

async function tx(who: KeyPairSigner, action: string, body: Record<string, unknown>) {
  const r = await call(routes.tx!.POST!(await signed(who, "POST", `/api/v1/tx/${action}`, body), params({ action })))
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body
}

const usdcOf = async (owner: string) => {
  const { value } = await client.rpc.getTokenAccountBalance(await usdcAccount(owner as never)).send()
  return BigInt(value.amount)
}

const SPEC = {
  v: "samite/job@1",
  title: "Scrape 2,000 real-estate listings",
  instructions: "Collect 2,000 active listings from the public pages of example.com in Lisbon and Porto. Return a CSV.",
  accepted_when: ["2,000 unique URLs that open", "price_eur and city filled on every row"],
  deliverable: { kind: "file", max_bytes: 10_000_000 },
  category: "data",
}
const CSV = "url,price_eur,city\nhttps://example.com/l/1,345000,Lisbon\n"

describe("the HTTP API on the local validator", () => {
  let no = ""
  let pda = ""

  it("stores and moderates a spec, then serves its exact bytes", async () => {
    const r = await call(routes.specs!.POST!(await signed(k.poster, "POST", "/api/v1/specs", { spec: SPEC })))
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body).toMatchObject({ verdict: "pass", reasons: [expect.stringMatching(/^local pass/)] })
    const canonical = Buffer.from(r.body.canonical as string, "base64")
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(r.body.spec_hash)

    // a spec that breaks the format is refused with its errors, and nothing is stored
    const bad = await call(
      routes.specs!.POST!(await signed(k.poster, "POST", "/api/v1/specs", { spec: { ...SPEC, title: "short" } })),
    )
    expect(bad).toMatchObject({ status: 422, body: { error: { code: "spec_invalid" } } })

    // every claim lapses (no 0 since Nov 13): a zero or too-long window is refused before anything is built
    for (const claim_window of [0, "30m", "4d"]) {
      const refused = await call(
        routes.tx!.POST!(
          await signed(k.poster, "POST", "/api/v1/tx/post", {
            spec_hash: r.body.spec_hash,
            reward: "80000000",
            deadline: "3d",
            claim_window,
          }),
          params({ action: "post" }),
        ),
      )
      expect(refused, String(claim_window)).toMatchObject({ status: 400, body: { error: { code: "bad_request" } } })
      await new Promise((r) => setTimeout(r, 1_050)) // the next signed request must not be a replay of this second's
    }

    const post = await tx(k.poster, "post", {
      spec_hash: r.body.spec_hash,
      reward: "80000000",
      deadline: "3d",
      review_window: "48h",
    })
    // the summary carries the instruction's own amounts, and the rent the chain asks for today (Job size checked
    // against a real account in apps/worker's LiteSVM suite)
    expect(post.summary.usdc).toEqual({ lock: "80000000", to_machine: "78000000", fee: "2000000" })
    const rent =
      (await client.rpc.getMinimumBalanceForRentExemption(BigInt(JOB_ACCOUNT_BYTES)).send()) +
      (await client.rpc.getMinimumBalanceForRentExemption(165n).send())
    expect(post.summary.rent_lamports).toBe(rent.toString())
    expect(post.summary.network_fee_lamports).toBe("5000")
    const postSig = await signAndSend(k.poster, post.transaction)
    pda = post.summary.job
    // where a transaction is, for a page whose own RPC can't answer (GET /tx/status)
    const status = await call(
      routes.tx!.GET!(new Request(`${ORIGIN}/api/v1/tx/status?signature=${postSig}`), params({ action: "status" })),
    )
    expect(status.body).toMatchObject({ signature: postSig, err: null })
    expect(["confirmed", "finalized"]).toContain(status.body.status)
    const notASig = await call(
      routes.tx!.GET!(new Request(`${ORIGIN}/api/v1/tx/status?signature=nope`), params({ action: "status" })),
    )
    expect(notASig).toMatchObject({ status: 400, body: { error: { code: "bad_request" } } })
    // no window named: 24 h
    expect((await fetchJob(client.rpc, address(pda))).data.claimWindow).toBe(86_400n)

    const board = await call(routes.jobs!.GET!(new Request(`${ORIGIN}/api/v1/jobs`)))
    const listed = (board.body.jobs as { pda: string; no: string; title: string; reward: string }[]).find(
      (j) => j.pda === pda,
    )!
    expect(listed).toMatchObject({ title: SPEC.title, reward: "80000000", status: "open" })
    no = listed.no

    const bytes = await routes.spec!.GET!(new Request(`${ORIGIN}/api/v1/jobs/${no}/spec.json`), params({ ref: no }))
    expect(
      createHash("sha256")
        .update(Buffer.from(await bytes.arrayBuffer()))
        .digest("hex"),
    ).toBe(r.body.spec_hash)
    expect(bytes.headers.get("cache-control")).toContain("immutable")
  })

  it("simulates before any wallet signs: a wallet short of SOL or USDC hears what is missing", async () => {
    // Phantom blocked the owner's first post on mainnet (Nov 14) because the wallet was 0.0001 SOL short of the rent:
    // the transaction failed its simulation. The server simulates first now (lib/server/preflight.ts).
    const spec = await call(routes.specs!.POST!(await signed(k.poster, "POST", "/api/v1/specs", { spec: SPEC })))
    const body = { spec_hash: spec.body.spec_hash, reward: "1000000", deadline: "24h", review_window: "24h" }
    const broke = await generateKeyPairSigner()
    const noSol = await call(
      routes.tx!.POST!(await signed(broke, "POST", "/api/v1/tx/post", body), params({ action: "post" })),
    )
    expect(noSol).toMatchObject({ status: 409, body: { error: { code: "insufficient_funds" } } })
    expect(noSol.body.error.message).toMatch(
      /^Your wallet has 0 SOL; this needs about [\d.]+ SOL: [\d.]+ account rent, which comes back when the job closes, [\d.]+ that Solana requires every wallet to keep, and about [\d.]+ for network fees\./,
    )
    expect(noSol.body.error.details).toMatchObject({ asset: "SOL", have_lamports: "0" })

    // SOL now, still no USDC
    await client.rpc.requestAirdrop(broke.address, lamports(1_000_000_000n)).send()
    for (let i = 0; i < 40 && (await client.rpc.getBalance(broke.address).send()).value === 0n; i++)
      await new Promise((r) => setTimeout(r, 250))
    const noUsdc = await call(
      routes.tx!.POST!(await signed(broke, "POST", "/api/v1/tx/post", body), params({ action: "post" })),
    )
    expect(noUsdc).toMatchObject({ status: 409, body: { error: { code: "insufficient_funds" } } })
    expect(noUsdc.body.error.message).toBe(
      "Your wallet has no USDC yet; this locks 1.00 USDC. Add USDC and try again. Nothing was signed.",
    )
  })

  it("refuses to let the poster claim their own job", async () => {
    const r = await call(
      routes.tx!.POST!(await signed(k.poster, "POST", "/api/v1/tx/claim", { job: no }), params({ action: "claim" })),
    )
    expect(r).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } })
  })

  it("lets a machine claim, upload, store a manifest whose hashes match, and deliver", async () => {
    await signAndSend(k.machine, (await tx(k.machine, "claim", { job: no })).transaction)
    const sha = createHash("sha256").update(CSV).digest("hex")
    const up = await call(
      routes.upload!.POST!(
        await signed(k.machine, "POST", "/api/v1/deliveries/upload", {
          job: no,
          name: "listings.csv",
          bytes: CSV.length,
        }),
      ),
    )
    expect(up.status, JSON.stringify(up.body)).toBe(201)
    // a stranger gets no upload URL
    const stranger = await call(
      routes.upload!.POST!(
        await signed(k.machine2, "POST", "/api/v1/deliveries/upload", { job: no, name: "x.csv", bytes: 3 }),
      ),
    )
    expect(stranger.body.error.code).toBe("forbidden")

    const url = new URL(up.body.upload.url as string)
    const key = url.pathname.replace("/api/v1/blobs/", "").split("/")
    const put = await routes.blobs!.PUT!(new Request(url, { method: "PUT", body: CSV }), params({ key }))
    expect(put.status).toBe(200)

    const manifest = {
      v: "samite/delivery@1",
      job: pda,
      attempt: 1,
      kind: "file",
      files: [{ name: "listings.csv", bytes: CSV.length, sha256: sha }],
      note: "All rows.",
    }
    const files = [{ name: "listings.csv", key: up.body.key }]
    const lie = await call(
      routes.deliveries!.POST!(
        await signed(k.machine, "POST", "/api/v1/deliveries", {
          job: no,
          manifest: { ...manifest, files: [{ ...manifest.files[0], sha256: "0".repeat(64) }] },
          files,
        }),
      ),
    )
    expect(lie.body.error.code).toBe("hash_mismatch")
    const stored = await call(
      routes.deliveries!.POST!(await signed(k.machine, "POST", "/api/v1/deliveries", { job: no, manifest, files })),
    )
    expect(stored.status, JSON.stringify(stored.body)).toBe(201)

    await signAndSend(
      k.machine,
      (await tx(k.machine, "deliver", { job: no, delivery_hash: stored.body.delivery_hash })).transaction,
    )
    const job = await call(routes.job!.GET!(new Request(`${ORIGIN}/api/v1/jobs/${no}`), params({ ref: no })))
    expect(job.body.job).toMatchObject({
      status: "delivered",
      deliveries: 1,
      delivery_hash: stored.body.delivery_hash,
      worker: k.machine.address,
    })
  })

  it("shows the delivery to the poster only, with a hash that matches the chain", async () => {
    const r = await call(
      routes.delivery!.GET!(await signed(k.poster, "GET", `/api/v1/jobs/${no}/delivery`), params({ ref: no })),
    )
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.deliveries[0]).toMatchObject({ attempt: 1, matches_chain: true, files: [{ name: "listings.csv" }] })
    const nope = await call(
      routes.delivery!.GET!(await signed(k.machine2, "GET", `/api/v1/jobs/${no}/delivery`), params({ ref: no })),
    )
    expect(nope.body.error.code).toBe("forbidden")
  })

  it("pays 97.5% to the machine and 2.5% to the treasury when the poster accepts, and every count follows", async () => {
    const before = { machine: await usdcOf(k.machine.address), treasury: await usdcOf(k.treasury.address) }
    const accept = await tx(k.poster, "accept", { job: no })
    expect(accept.summary.usdc).toEqual({ to_machine: "78000000", fee: "2000000" })
    await signAndSend(k.poster, accept.transaction)
    expect((await usdcOf(k.machine.address)) - before.machine).toBe(78_000_000n)
    expect((await usdcOf(k.treasury.address)) - before.treasury).toBe(2_000_000n)

    const job = await call(routes.job!.GET!(new Request(`${ORIGIN}/api/v1/jobs/${no}`), params({ ref: no })))
    expect(job.body.job.status).toBe("paid")
    expect((job.body.events as { kind: string }[]).map((e) => e.kind)).toEqual([
      "posted",
      "claimed",
      "delivered",
      "paid",
    ])
    const m = await call(
      routes.machine!.GET!(
        new Request(`${ORIGIN}/api/v1/machines/${k.machine.address}`),
        params({ address: k.machine.address }),
      ),
    )
    expect(m.body.accepted).toBe(m.body.chain.accepted)
    expect(m.body.earned).toBe(m.body.chain.earned)
    const st = await call(routes.stats!.GET!(new Request(`${ORIGIN}/api/v1/stats`)))
    expect(BigInt(st.body.paid_24h)).toBeGreaterThanOrEqual(78_000_000n)
  })

  it("won't let a machine take back a job it dropped; another machine can, and the program agrees", async () => {
    const spec = await call(routes.specs!.POST!(await signed(k.poster, "POST", "/api/v1/specs", { spec: SPEC })))
    const post = await tx(k.poster, "post", {
      spec_hash: spec.body.spec_hash,
      reward: "5000000",
      deadline: "3d",
      review_window: "48h",
    })
    await signAndSend(k.poster, post.transaction)
    const job = post.summary.job as string

    await signAndSend(k.machine, (await tx(k.machine, "claim", { job })).transaction)
    const drop = await tx(k.machine, "unclaim", { job })
    expect(drop.summary.lines.join(" ")).toContain("you can't claim it again")
    await signAndSend(k.machine, drop.transaction)

    // the API says why before anything is signed…
    const again = await call(
      routes.tx!.POST!(await signed(k.machine, "POST", "/api/v1/tx/claim", { job }), params({ action: "claim" })),
    )
    expect(again).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } })
    expect(again.body.error.message).toContain("can't claim it again")
    // …and a transaction built without the API fails on-chain with CannotReclaim (6034)
    const { actions } = await import("@samite/program-client")
    const { USDC_MINT } = await import("@samite/config/solana")
    const direct = await actions.claimJob({ usdcMint: USDC_MINT as never }, { machine: k.machine, job: job as never })
    const refused = await client.send(k.machine, [direct]).then(
      () => null,
      (e: { cause?: { context?: { code?: number } } }) => e,
    )
    expect(refused?.cause?.context?.code).toBe(6034)

    // another machine can claim it; then it drops it too and the poster takes the reward back
    await signAndSend(k.machine2, (await tx(k.machine2, "claim", { job })).transaction)
    await signAndSend(k.machine2, (await tx(k.machine2, "unclaim", { job })).transaction)
    await signAndSend(k.poster, (await tx(k.poster, "cancel", { job })).transaction)
    const done = await call(routes.job!.GET!(new Request(`${ORIGIN}/api/v1/jobs/${job}`), params({ ref: job })))
    expect((done.body.events as { kind: string }[]).map((e) => e.kind)).toEqual([
      "posted",
      "claimed",
      "unclaimed",
      "claimed",
      "unclaimed",
      "cancelled",
    ])
  })

  it("relays only transactions for the escrow program", async () => {
    const r = await call(
      routes.tx!.POST!(
        new Request(`${ORIGIN}/api/v1/tx/send`, { method: "POST", body: JSON.stringify({ transaction: "AAAA" }) }),
        params({ action: "send" }),
      ),
    )
    expect(r.body.error.code).toBe("tx_invalid")
  })
})
