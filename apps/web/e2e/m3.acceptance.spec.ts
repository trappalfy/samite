// M3 acceptance (CLAUDE.md §14): a person posts a job in the browser, a scripted machine claims and delivers, the
// person accepts, and every number on the job, board, machine and my-jobs screens equals the chain.
// Local only: `pnpm --filter @samite/local run up`, then `pnpm --filter web e2e:m3`.
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import {
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  signBytes,
  signTransaction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit"
import { formatUsdc } from "@samite/config/money"
import { formatAuthorization, requestMessage } from "@samite/formats"
import { isUp, keyPath, loadSigners, localClient, usdcAccount } from "@samite/local"
import {
  fetchMaybeMachineStats,
  findMachineStatsPda,
  getJobDecoder,
  JOB_DISCRIMINATOR,
  JobStatus,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
} from "@samite/program-client"
import { BASE, LOCAL_DB } from "../playwright.m3.config"
import { injectTestWallet } from "./test-wallet"

const PROGRESS = new URL("../../../docs/progress/m3/", import.meta.url).pathname
const chain = localClient()
type Keys = Awaited<ReturnType<typeof loadSigners>>
let k: Keys
let worker: ChildProcess

test.beforeAll(async () => {
  if (!(await isUp())) throw new Error("start the local harness first: pnpm --filter @samite/local run up")
  k = await loadSigners()
  // the worker: indexer + keeper, on for this local validator only (KEEPER_ENABLED stays false everywhere else)
  const keeperSecret = getBase58Decoder().decode(Uint8Array.from(JSON.parse(readFileSync(keyPath("keeper"), "utf8"))))
  const cwd = new URL("../../worker/", import.meta.url).pathname
  // the tsx binary itself, leading its own process group, so afterAll stops every child
  worker = spawn(`${cwd}node_modules/.bin/tsx`, ["src/main.ts"], {
    cwd,
    env: {
      ...process.env,
      DATABASE_URL: LOCAL_DB,
      SOLANA_RPC_URL: "http://127.0.0.1:8899",
      KEEPER_ENABLED: "true",
      KEEPER_SECRET: keeperSecret,
      PORT: "8791",
    },
    stdio: "ignore",
    detached: true,
  })
  for (let i = 0; i < 60; i++) {
    if ((await fetch("http://localhost:8791/health").catch(() => null))?.ok) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("the worker did not come up")
})
test.afterAll(() => {
  try {
    if (worker?.pid) process.kill(-worker.pid, "SIGTERM")
  } catch {
    /* already gone */
  }
})

// --- the scripted machine: signed HTTP requests and locally signed transactions (§6.1) ----------------------------

async function call(who: KeyPairSigner, method: string, path: string, body?: unknown) {
  const bytes = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body))
  const ts = Math.floor(Date.now() / 1000)
  const sig = getBase58Decoder().decode(
    await signBytes(
      who.keyPair.privateKey,
      new TextEncoder().encode(requestMessage({ method, pathAndQuery: path, ts, body: bytes })),
    ),
  )
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: formatAuthorization({ address: who.address, ts, sig }),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : bytes,
  })
  const json = (await res.json()) as Record<string, unknown> & { error?: { message: string } }
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.message}`)
  return json as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- deep reads of JSON
}

async function machineTx(who: KeyPairSigner, action: string, body: Record<string, unknown>) {
  const { transaction } = await call(who, "POST", `/api/v1/tx/${action}`, body)
  const signed = await signTransaction(
    [who.keyPair],
    getTransactionDecoder().decode(getBase64Encoder().encode(transaction)),
  )
  const { signature } = await call(who, "POST", "/api/v1/tx/send", {
    transaction: getBase64Decoder().decode(getTransactionEncoder().encode(signed)),
  })
  await confirmed(signature)
}

async function confirmed(signature: string) {
  for (let i = 0; i < 120; i++) {
    const { value } = await chain.rpc.getSignatureStatuses([signature as Signature]).send()
    if (value[0]?.err) throw new Error(`failed on-chain: ${JSON.stringify(value[0].err)}`)
    if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error("not confirmed")
}

/** Waits until the index (the worker) shows the job in this status. */
async function indexed(ref: string, status: string) {
  for (let i = 0; i < 120; i++) {
    const r = await fetch(`${BASE}/api/v1/jobs/${ref}`)
    if (r.ok && ((await r.json()) as { job: { status: string } }).job.status === status) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`job ${ref} never became ${status} in the index`)
}

const usdcOf = async (owner: string) =>
  BigInt((await chain.rpc.getTokenAccountBalance(await usdcAccount(owner as never)).send()).value.amount)
const lamportsOf = async (a: string) => (await chain.rpc.getBalance(a as never).send()).value

/** Every live Job account of the program, read from the chain. */
async function chainJobs() {
  const accounts = await chain.rpc
    .getProgramAccounts(SAMITE_ESCROW_PROGRAM_ADDRESS, {
      encoding: "base64",
      // by the account's discriminator, not its size, so a layout change can't make this find nothing
      filters: [
        { memcmp: { offset: 0n, encoding: "base58", bytes: getBase58Decoder().decode(JOB_DISCRIMINATOR) as never } },
      ],
    })
    .send()
  return accounts.map((a) => ({
    address: a.pubkey,
    ...getJobDecoder().decode(getBase64Encoder().encode(a.account.data[0])),
  }))
}

const shots = async (page: import("@playwright/test").Page, name: string) => {
  if (process.env.UPDATE_PROGRESS !== "1") return
  mkdirSync(PROGRESS, { recursive: true })
  await page.screenshot({ path: `${PROGRESS}${name}.png`, fullPage: true })
  // the phone size too (CLAUDE.md §0: every UI PR shows 1440×900 and 390×844); the presses re-lay out after 120 ms
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${PROGRESS}${name}-mobile.png`, fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(400)
}

test("a person posts in the browser, a machine claims and delivers, the person accepts; every number matches the chain", async ({
  page,
}) => {
  // no page may throw, a hydration mismatch included (React #418, found by Lighthouse on the live pages)
  const pageErrors: string[] = []
  // each with the page it happened on
  page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${e.message}`))
  page.on("console", (m) => {
    if (m.type() === "error" && /React error|Hydration/i.test(m.text()))
      pageErrors.push(`${new URL(page.url()).pathname}: ${m.text()}`)
  })
  const before = {
    poster: await usdcOf(k.poster.address),
    machine: await usdcOf(k.machine.address),
    treasury: await usdcOf(k.treasury.address),
    posterSol: await lamportsOf(k.poster.address),
  }
  const wallet = await injectTestWallet(page, k.poster)

  // 1. connect the wallet
  await page.goto("/jobs")
  await page.getByRole("button", { name: "Connect wallet" }).click()
  await page.getByRole("button", { name: "Samite Test Wallet" }).click()
  await expect(page.getByRole("button", { name: `Wallet ${k.poster.address}` })).toBeVisible()

  // 2. post a job in the browser: spec → moderation (local pass) → post_job, signed by the wallet
  await page.goto("/jobs/new")
  await page.getByLabel("Title").fill("Scrape 2,000 real-estate listings")
  await page
    .getByLabel("Instructions (Markdown)")
    .fill("Collect 2,000 active listings from the public pages of example.com in Lisbon and Porto. Return a **CSV**.")
  await page.getByLabel("Accepted when").fill("2,000 unique URLs that open\nprice_eur and city filled on every row")
  await page.getByLabel("Reward", { exact: true }).fill("80")
  const summary = page.getByRole("region", { name: "Summary" })
  await expect(summary).toContainText("Machine receives (97.5%)78.00 USDC")
  await expect(summary).toContainText("Samite fee (2.5%)2.00 USDC")
  await page.getByRole("button", { name: "Lock 80 USDC and post" }).click()
  await page.waitForURL(/\/jobs\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, { timeout: 120_000 })
  const pda = page.url().split("/").pop()!
  expect(wallet.map((w) => w.kind)).toEqual(["signIn", "tx"]) // one sign-in, one transaction

  await expect(page.locator("[data-chain-check]")).toHaveAttribute("data-chain-check", "ok")
  await expect(page.getByText(/Spec sha256 .* ✓ matches on-chain hash/)).toBeVisible()
  expect(await usdcOf(k.poster.address)).toBe(before.poster - 80_000_000n)
  await shots(page, "job-open")

  // 3. the scripted machine: claim, upload, manifest, deliver (plain HTTP + local signing)
  await machineTx(k.machine, "claim", { job: pda })
  await indexed(pda, "claimed")
  const csv =
    "url,price_eur,area_m2,rooms,city,listed_at\nhttps://example.com/l/88412,345000,74,3,Lisbon,2026-11-02\nhttps://example.com/l/88419,289500,61,2,Porto,2026-11-03\n"
  const up = await call(k.machine, "POST", "/api/v1/deliveries/upload", {
    job: pda,
    name: "listings.csv",
    bytes: Buffer.byteLength(csv),
  })
  expect((await fetch(up.upload.url, { method: "PUT", body: csv })).ok).toBe(true)
  const manifest = {
    v: "samite/delivery@1",
    job: pda,
    attempt: 1,
    kind: "file",
    files: [
      { name: "listings.csv", bytes: Buffer.byteLength(csv), sha256: createHash("sha256").update(csv).digest("hex") },
    ],
    note: "All rows. 14 listings had no area; left empty as allowed in the spec.",
  }
  const { delivery_hash } = await call(k.machine, "POST", "/api/v1/deliveries", {
    job: pda,
    manifest,
    files: [{ name: "listings.csv", key: up.key }],
  })
  await machineTx(k.machine, "deliver", { job: pda, delivery_hash })
  await indexed(pda, "delivered")

  // 4. the person reviews: the delivery's hash is re-computed in the browser and matches the chain
  await page.reload()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Scrape 2,000 real-estate listings")
  await expect(page.locator("main").getByText("Delivered", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "Show the delivery" }).click()
  await expect(page.locator("[data-delivery-check]")).toHaveAttribute("data-delivery-check", "ok")
  await page.getByRole("button", { name: "Preview the first rows" }).click()
  await expect(page.getByLabel("First rows of the delivered file")).toContainText("https://example.com/l/88412,345000")
  // on a phone, long CSV lines scroll inside the preview, never the page
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.setViewportSize({ width: 1440, height: 900 })
  await shots(page, "job-delivered")

  // 5. accept: one transaction pays the machine 97.5% and the treasury 2.5%
  await page.getByRole("button", { name: "Accept and pay 78.00 USDC" }).click()
  await indexed(pda, "paid")
  await page.reload()
  await expect(page.locator("main").getByText("Paid", { exact: true }).first()).toBeVisible()
  await expect(page.locator("[data-chain-check]")).toContainText("the job account is closed")
  await shots(page, "job-paid")

  // --- every number against the chain -----------------------------------------------------------------------------
  expect(await usdcOf(k.machine.address)).toBe(before.machine + 78_000_000n)
  expect(await usdcOf(k.treasury.address)).toBe(before.treasury + 2_000_000n)
  expect(await usdcOf(k.poster.address)).toBe(before.poster - 80_000_000n)
  // the job's and the vault's rent came back: the poster's SOL moved only by the network fees of its two transactions
  const detail = (await (await fetch(`${BASE}/api/v1/jobs/${pda}`)).json()) as {
    job: { no: string }
    events: { kind: string; sig: string }[]
  }
  const posterSigs = detail.events.filter((e) => e.kind === "posted" || e.kind === "paid").map((e) => e.sig)
  let fees = 0n
  for (const sig of posterSigs)
    fees += (await chain.rpc
      .getTransaction(sig as Signature, {
        encoding: "json",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .send())!.meta!.fee
  expect(before.posterSol - (await lamportsOf(k.poster.address))).toBe(fees)

  // job page: escrow numbers
  const escrow = page.getByRole("region", { name: "Escrow" })
  await expect(escrow).toContainText("To the machine78.00")
  await expect(escrow).toContainText("Fee2.00 (2.5%)")

  // machine page: the chain's MachineStats
  const [statsPda] = await findMachineStatsPda({ machine: k.machine.address })
  const stats = await fetchMaybeMachineStats(chain.rpc, statsPda)
  if (!stats.exists) throw new Error("no MachineStats")
  await page.goto(`/machines/${k.machine.address}`)
  await expect(page.locator("main")).toContainText(`Accepted jobs${stats.data.accepted}`)
  await expect(page.locator("main")).toContainText(`Earned${formatUsdc(stats.data.earned)} USDC`)
  await expect(page.locator(`a[href="/jobs/${detail.job.no}"]`)).toBeVisible()
  await shots(page, "machine")

  // board: open jobs and USDC in escrow, against the program's live Job accounts. Escrow counts every live job (the
  // money is on-chain whatever moderation said); "open" counts the open ones the board may list, i.e. not hidden
  // (a job posted without its spec stored here is hidden, and the API answers 404 for it).
  const live = await chainJobs()
  const listed = await Promise.all(
    live
      .filter((j) => j.status === JobStatus.Open)
      .map(async (j) => (await fetch(`${BASE}/api/v1/jobs/${j.address}`)).status === 200),
  )
  const open = listed.filter(Boolean).length
  const locked = live.reduce((n, j) => n + j.reward, 0n)
  await page.goto("/jobs")
  await expect(page.locator("main")).toContainText(
    `${open} open · ${formatUsdc(locked, { decimals: 0 })} USDC in escrow`,
  )
  await expect(page.getByRole("region", { name: "Live" })).toContainText(`${detail.job.no} paid 78.00 →`)
  await shots(page, "board")

  // landing: the hero's module goes live once something settled in the last 24 h, with the chain's escrow (§11.10)
  await page.goto("/")
  await expect(page.locator("main")).toContainText(`Escrow locked${formatUsdc(locked, { decimals: 0 })} USDC`)
  await expect(page.getByText("example values; live from /api/v1/stats in production")).toHaveCount(0)
  if (process.env.UPDATE_PROGRESS === "1") {
    await page.waitForTimeout(1500) // the hero's entrance; the first screen is what matters here
    await page.screenshot({ path: `${PROGRESS}landing-live.png` })
  }

  // my jobs: the poster's job, paid
  await page.goto("/me")
  const row = page.locator("tbody tr").filter({ hasText: `JOB ${detail.job.no}` })
  await expect(row).toContainText("80.00")
  await expect(row).toContainText("Paid")
  await shots(page, "me")
  expect(pageErrors).toEqual([])
})

// Times shown as "how long ago" must not depend on whose clock renders them: the server renders the page, the browser
// hydrates it a moment later, maybe with a clock that is off. A label computed from each one's own clock differs
// ("51s" → "52s", or by minutes with a skewed clock) and React throws #418. Here the browser's clock runs two minutes
// ahead of the server's, on every app page, with the jobs and events the run above left on the chain.
test("a browser whose clock is two minutes off renders every app page without a hydration mismatch", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message}`))
  page.on("console", (m) => {
    if (m.type() === "error" && /React error|Hydration/i.test(m.text()))
      errors.push(`${new URL(page.url()).pathname}: ${m.text()}`)
  })
  await page.clock.install({ time: Date.now() + 120_000 })
  const jobs = (await (await fetch(`${BASE}/api/v1/jobs?status=all&limit=5`)).json()) as { jobs: { no: string }[] }
  for (const path of [
    "/jobs",
    ...jobs.jobs.map((j) => `/jobs/${j.no}`),
    `/machines/${k.machine.address}`,
    "/machines",
    "/me",
    "/jobs/new",
  ]) {
    await page.goto(path)
    await page.clock.runFor(1500)
  }
  expect(errors).toEqual([])
})
