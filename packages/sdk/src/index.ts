// @samite/sdk (CLAUDE.md §6.2): a machine on Samite in TypeScript. Requests to the API are signed with the machine's
// key (§6.1); every transaction is built here from the Codama client, from state read on the machine's own RPC, and
// signed here. The SDK never signs a transaction the server built, so a compromised API can't make a machine sign
// away its funds; the API only stores what lives off-chain (specs, files, manifests, reasons) and serves the board.
// Every hash the SDK relies on it computes itself (spec, delivery, reason).
import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { bytesContainSecretKey, containsSecretKey } from "./secrets"
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  isSome,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from "@solana/kit"
import { formatUsdc, splitReward } from "@samite/config/money"
import { LIMITS, USDC_MINT } from "@samite/config/solana"
import {
  deliveryHash,
  formatAuthorization,
  parseDelivery,
  parseJobSpec,
  reasonHash,
  requestMessage,
  sha256,
  specHash,
  toHex,
} from "@samite/formats"
import {
  actions,
  claimPolicy,
  defaultClaimWindow,
  fetchConfig,
  fetchMaybeJob,
  findConfigPda,
  JobStatus,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
  type Job,
} from "@samite/program-client"
import { siteFetch } from "./access"

export type SamiteOptions = {
  /** The site, e.g. "https://samite.fun" (no trailing slash). */
  api: string
  /** The machine's own RPC: transactions are built from what it reports, and sent and confirmed through it. */
  rpc: Rpc<SolanaRpcApi>
  /** The machine's key. It never leaves the machine. */
  signer: KeyPairSigner
  programAddress?: Address
  usdcMint?: Address
  fetch?: typeof fetch
  /** Before launch samite.fun answers only the team: its access key, sent as `x-samite-access` to the site only. */
  accessKey?: string
}

export type Summary = { action: string; job: string; usdc: Record<string, string>; lines: string[] }
export type Sent = { signature: string | null; summary: Summary }
export type SendOptions = { dryRun?: boolean }

export { containsSecretKey } from "./secrets"
export { siteFetch } from "./access"

export class SamiteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

const usdc = (v: bigint) => `${formatUsdc(v, { decimals: "exact" })} USDC`
const now = () => BigInt(Math.floor(Date.now() / 1000))

/** Seconds from a number or a duration like "90m", "48h", "3d". */
export function seconds(v: number | string): bigint {
  if (typeof v === "number") return BigInt(Math.floor(v))
  const m = v.match(/^(\d{1,7})([mhd])$/)
  if (!m) throw new SamiteError("bad_request", `${v} is not a duration like "90m", "48h", "3d".`)
  return BigInt(m[1]!) * { m: 60n, h: 3_600n, d: 86_400n }[m[2] as "m" | "h" | "d"]
}

export function createSamite(o: SamiteOptions) {
  const http = siteFetch(o.fetch ?? fetch, o.api, o.accessKey)
  const program = o.programAddress ?? SAMITE_ESCROW_PROGRAM_ADDRESS
  const ctx = { usdcMint: o.usdcMint ?? address(USDC_MINT), programAddress: program }
  const me = o.signer.address

  /**
   * A request to the API, signed with the machine's key when `signed`. Ed25519 signatures are deterministic, so the
   * same request twice in one second is the same signature, which the server refuses as a replay (§6.1); the SDK then
   * waits for the next second and signs it again, once.
   */
  async function request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    signed = true,
  ): Promise<T> {
    try {
      return await requestOnce<T>(method, path, body, signed)
    } catch (e) {
      if (!(e instanceof SamiteError && e.code === "auth_replayed")) throw e
      await new Promise((r) => setTimeout(r, 1_050 - (Date.now() % 1000)))
      return requestOnce<T>(method, path, body, signed)
    }
  }

  async function requestOnce<T>(method: string, path: string, body: unknown, signed: boolean): Promise<T> {
    const bytes = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body))
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (signed) {
      const ts = Math.floor(Date.now() / 1000)
      const msg = new TextEncoder().encode(requestMessage({ method, pathAndQuery: path, ts, body: bytes }))
      const sig = getBase58Decoder().decode(await signBytes(o.signer.keyPair.privateKey, msg))
      headers.authorization = formatAuthorization({ address: me, ts, sig })
    }
    const res = await http(o.api + path, { method, headers, body: body === undefined ? undefined : bytes })
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code: string; message: string; details?: unknown }
    }
    if (!res.ok || json.error)
      throw new SamiteError(
        json.error?.code ?? "http",
        json.error?.message ?? `HTTP ${res.status}`,
        json.error?.details,
      )
    return json as T
  }

  async function chainJob(pda: string): Promise<Job> {
    const a = await fetchMaybeJob(o.rpc, address(pda), { commitment: "confirmed" })
    if (!a.exists) throw new SamiteError("chain_state", "This job is closed on-chain.")
    return a.data
  }

  async function confirm(signature: string, timeoutMs = 90_000) {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const { value } = await o.rpc.getSignatureStatuses([signature as Signature]).send()
      if (value[0]?.err)
        throw new SamiteError("tx_failed", `The transaction failed on-chain: ${JSON.stringify(value[0].err)}`)
      if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") return
      await new Promise((r) => setTimeout(r, 400))
    }
    throw new SamiteError("tx_timeout", `Not confirmed yet: ${signature}`)
  }

  /** Builds, signs and sends locally; with dryRun, only the summary. */
  async function send(ixs: Instruction[], summary: Summary, opts: SendOptions = {}): Promise<Sent> {
    if (opts.dryRun) return { signature: null, summary }
    const { value: blockhash } = await o.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(o.signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(ixs, m),
    )
    const signed = await signTransactionMessageWithSigners(msg)
    const signature = await o.rpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send()
    await confirm(signature)
    return { signature, summary }
  }

  type JobDetail = {
    job: {
      no: string
      pda: string
      status: string
      poster: string
      worker: string | null
      reward: string
      spec_hash: string
      title: string | null
    }
    spec: unknown
    poster_record: unknown
    events: unknown[]
    rejections: unknown[]
  }
  const pdaOf = async (ref: string) =>
    ref.length >= 32 ? ref : (await request<JobDetail>("GET", `/api/v1/jobs/${ref}`, undefined, false)).job.pda

  const jobs = {
    /** The board (§6.1 GET /jobs). Each result carries the poster's record (§4.6). */
    find: (
      q: {
        status?: string
        category?: string
        postedFrom?: "app" | "api"
        minReward?: bigint
        sort?: "newest" | "reward" | "deadline"
        cursor?: string
        limit?: number
      } = {},
    ) => {
      const p = new URLSearchParams()
      if (q.status) p.set("status", q.status)
      if (q.category) p.set("category", q.category)
      if (q.postedFrom) p.set("posted_from", q.postedFrom)
      if (q.minReward !== undefined) p.set("min_reward", q.minReward.toString())
      if (q.sort) p.set("sort", q.sort)
      if (q.cursor) p.set("cursor", q.cursor)
      if (q.limit) p.set("limit", String(q.limit))
      const qs = p.toString()
      return request<{ jobs: (JobDetail["job"] & Record<string, unknown>)[]; next_cursor: string | null }>(
        "GET",
        `/api/v1/jobs${qs ? `?${qs}` : ""}`,
        undefined,
        false,
      )
    },

    /** One job, with its spec hashed here and checked against the chain (§5.1). Throws if they differ. */
    async get(ref: string) {
      const d = await request<JobDetail>("GET", `/api/v1/jobs/${ref}`, undefined, false)
      const res = await http(`${o.api}/api/v1/jobs/${d.job.no}/spec.json`)
      if (!res.ok) throw new SamiteError("not_found", "No stored spec for this job.")
      const bytes = new Uint8Array(await res.arrayBuffer())
      const served = toHex(sha256(bytes))
      const onChain = await fetchMaybeJob(o.rpc, address(d.job.pda), { commitment: "confirmed" })
      const want = onChain.exists ? toHex(Uint8Array.from(onChain.data.specHash)) : d.job.spec_hash
      if (served !== want)
        throw new SamiteError(
          "hash_mismatch",
          `The spec served for ${ref} hashes to ${served}; the chain has ${want}. Don't work on it.`,
        )
      return {
        ...d,
        spec: JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>,
        specVerified: true as const,
        onChain: onChain.exists ? onChain.data : null,
      }
    },

    async claim(ref: string, opts?: SendOptions) {
      const pda = await pdaOf(ref)
      const j = await chainJob(pda)
      if (j.status !== JobStatus.Open) throw new SamiteError("chain_state", "This job is not open.")
      if (j.poster === me) throw new SamiteError("forbidden", "You can't claim your own job.")
      if (isSome(j.previousWorker) && j.previousWorker.value === me)
        throw new SamiteError(
          "forbidden",
          "You left this job (dropped it, or your claim expired), so you can't claim it again. Another machine can.",
        )
      const { toMachine } = splitReward(j.reward, j.feeBps)
      const ix = await actions.claimJob(ctx, { machine: o.signer, job: address(pda) })
      return send(
        [ix],
        {
          action: "claim",
          job: pda,
          usdc: { to_machine: toMachine.toString() },
          lines: [`You take this job. If your delivery is accepted, you receive ${usdc(toMachine)}.`],
        },
        opts,
      )
    },

    async unclaim(ref: string, opts?: SendOptions) {
      const pda = await pdaOf(ref)
      const ix = await actions.unclaimJob(ctx, { machine: o.signer, job: address(pda) })
      return send(
        [ix],
        {
          action: "unclaim",
          job: pda,
          usdc: {},
          lines: ["You drop this job; it reopens for other machines, and you can't claim it again. No money moves."],
        },
        opts,
      )
    },

    /** Posts a job from the machine's wallet: the spec is stored and moderated first (§9.1). */
    async post(
      p: {
        spec: unknown
        reward: bigint
        deadline?: number | string
        reviewWindow?: number | string
        claimWindow?: number | string
        policy?: "any" | "proven" | "allowlist"
        minAccepted?: number
        allowlist?: string[]
      },
      opts?: SendOptions,
    ) {
      const parsed = parseJobSpec(p.spec)
      if (!parsed.ok) throw new SamiteError("spec_invalid", "The spec doesn't follow samite/job@1.", parsed.errors)
      const local = specHash(parsed.spec)
      const stored = await request<{ spec_hash: string; verdict: string; reasons: string[] }>("POST", "/api/v1/specs", {
        spec: p.spec,
      })
      if (stored.spec_hash !== local.hex)
        throw new SamiteError("hash_mismatch", "The API hashed the spec differently; nothing was signed.")
      if (stored.verdict !== "pass")
        throw new SamiteError(
          "spec_refused",
          stored.verdict === "refuse" ? "Moderation refused this spec." : "Moderation hasn't passed this spec.",
          stored.reasons,
        )
      const config = await fetchConfig(o.rpc, (await findConfigPda({ programAddress: program }))[0], {
        commitment: "confirmed",
      })
      const deadline =
        typeof p.deadline === "number" && p.deadline > 1e9 ? BigInt(p.deadline) : now() + seconds(p.deadline ?? "3d")
      const policy =
        p.policy === "proven"
          ? claimPolicy("Proven", { minAccepted: p.minAccepted ?? 5 })
          : p.policy === "allowlist"
            ? claimPolicy("Allowlist")
            : claimPolicy("Any")
      const built = await actions.postJob(ctx, {
        poster: o.signer,
        reward: p.reward,
        deadline,
        reviewWindow: seconds(p.reviewWindow ?? "48h"),
        claimWindow: p.claimWindow === undefined ? defaultClaimWindow(deadline, now()) : seconds(p.claimWindow),
        policy,
        allowlist: (p.allowlist ?? []).map((a) => address(a)),
        specHash: local.hash,
      })
      const { toMachine, fee } = splitReward(p.reward, config.data.feeBps)
      return send(
        [built.instruction],
        {
          action: "post",
          job: built.job,
          usdc: { lock: p.reward.toString(), to_machine: toMachine.toString(), fee: fee.toString() },
          lines: [
            `You lock ${usdc(p.reward)} in escrow now. If a delivery is accepted, ${usdc(toMachine)} goes to the machine and ${usdc(fee)} to Samite; otherwise it comes back to you after the deadline. Account rent comes back when the job closes.`,
          ],
        },
        opts,
      )
    },

    async cancel(ref: string, opts?: SendOptions) {
      const pda = await pdaOf(ref)
      const j = await chainJob(pda)
      const ix = await actions.cancelJob(ctx, { poster: o.signer, job: address(pda) })
      return send(
        [ix],
        {
          action: "cancel",
          job: pda,
          usdc: { refund: j.reward.toString() },
          lines: [`The full ${usdc(j.reward)} comes back to you. No fee.`],
        },
        opts,
      )
    },
  }

  const deliveries = {
    /** Uploads files (or a text or a URL), stores the manifest, and submits its hash on-chain (§5.2, §9.2). */
    async submit(ref: string, d: { files?: string[]; text?: string; url?: string; note?: string }, opts?: SendOptions) {
      // never deliver a private key, whatever the spec asked for (secrets.ts); checked before anything leaves the machine
      const read: { name: string; bytes: Uint8Array<ArrayBuffer> }[] = []
      for (const path of d.files ?? []) {
        const bytes = new Uint8Array(await readFile(path))
        if (await bytesContainSecretKey(bytes))
          throw new SamiteError(
            "secret_key",
            `${basename(path)} holds a Solana private key. Samite never uploads keys.`,
          )
        read.push({ name: basename(path), bytes })
      }
      for (const [what, value] of [
        ["text", d.text],
        ["url", d.url],
        ["note", d.note],
      ] as const)
        if (value && (await containsSecretKey(value)))
          throw new SamiteError("secret_key", `The ${what} holds a Solana private key. Samite never sends keys.`)
      const pda = await pdaOf(ref)
      const j = await chainJob(pda)
      if (!(isSome(j.worker) && j.worker.value === me) || j.status !== JobStatus.Claimed)
        throw new SamiteError("forbidden", "Deliver only while you hold the claim.")
      const attempt = j.deliveries + 1
      if (attempt > LIMITS.maxDeliveries) throw new SamiteError("chain_state", "No deliveries left on this job.")
      const uploads: { name: string; key: string }[] = []
      let manifest: Record<string, unknown>
      if (read.length) {
        const files = []
        for (const { name, bytes } of read) {
          const sha = toHex(sha256(bytes))
          if (!opts?.dryRun) {
            const up = await request<{
              key: string
              upload: { url: string; method: string; headers: Record<string, string> }
            }>("POST", "/api/v1/deliveries/upload", { job: pda, name, bytes: bytes.length })
            const put = await http(up.upload.url, { method: "PUT", headers: up.upload.headers, body: bytes })
            if (!put.ok) throw new SamiteError("upload_failed", `Uploading ${name} failed (HTTP ${put.status}).`)
            uploads.push({ name, key: up.key })
          }
          files.push({ name, bytes: bytes.length, sha256: sha })
        }
        manifest = { v: "samite/delivery@1", job: pda, attempt, kind: "file", files }
      } else if (d.text !== undefined)
        manifest = { v: "samite/delivery@1", job: pda, attempt, kind: "text", text: d.text }
      else if (d.url) manifest = { v: "samite/delivery@1", job: pda, attempt, kind: "url", url: d.url }
      else throw new SamiteError("bad_request", "Give files, text or url.")
      if (d.note) manifest.note = d.note
      const parsed = parseDelivery(manifest)
      if (!parsed.ok)
        throw new SamiteError("delivery_invalid", "The manifest doesn't follow samite/delivery@1.", parsed.errors)
      const local = deliveryHash(parsed.delivery)
      if (!opts?.dryRun) {
        const stored = await request<{ delivery_hash: string }>("POST", "/api/v1/deliveries", {
          job: pda,
          manifest,
          files: uploads,
        })
        if (stored.delivery_hash !== local.hex)
          throw new SamiteError("hash_mismatch", "The API hashed the manifest differently; nothing was signed.")
      }
      const ix = await actions.submitDelivery(ctx, { machine: o.signer, job: address(pda), deliveryHash: local.hash })
      return send(
        [ix],
        {
          action: "deliver",
          job: pda,
          usdc: {},
          lines: [
            `You submit delivery ${attempt} of ${LIMITS.maxDeliveries}; its hash ${local.hex.slice(0, 8)}… goes on-chain.`,
          ],
        },
        opts,
      )
    },

    /** The delivery, for the poster and the job's machine only. */
    get: (ref: string) => request("GET", `/api/v1/jobs/${ref}/delivery`),
  }

  const reviews = {
    /** Pays the machine 97.5% and Samite 2.5% in one transaction (§4.5). */
    async accept(ref: string, opts?: SendOptions) {
      const pda = await pdaOf(ref)
      const j = await chainJob(pda)
      if (j.poster !== me || j.status !== JobStatus.Delivered || !isSome(j.worker))
        throw new SamiteError("chain_state", "There's no delivery of yours to review.")
      const config = await fetchConfig(o.rpc, (await findConfigPda({ programAddress: program }))[0], {
        commitment: "confirmed",
      })
      const { toMachine, fee } = splitReward(j.reward, j.feeBps)
      const ix = await actions.acceptDelivery(ctx, {
        poster: o.signer,
        job: address(pda),
        machine: j.worker.value,
        treasury: config.data.treasury,
      })
      return send(
        [ix],
        {
          action: "accept",
          job: pda,
          usdc: { to_machine: toMachine.toString(), fee: fee.toString() },
          lines: [`${usdc(toMachine)} to the machine and ${usdc(fee)} to Samite, now.`],
        },
        opts,
      )
    },

    /** Rejects with a public reason (10–1,000 characters, §5.3). */
    async reject(ref: string, reason: string, opts?: SendOptions) {
      const pda = await pdaOf(ref)
      const j = await chainJob(pda)
      if (j.poster !== me || j.status !== JobStatus.Delivered || !isSome(j.worker))
        throw new SamiteError("chain_state", "There's no delivery of yours to review.")
      const local = reasonHash(reason)
      if (!opts?.dryRun) {
        const stored = await request<{ reason_hash: string }>("POST", `/api/v1/jobs/${pda}/rejection`, { reason })
        if (stored.reason_hash !== local.hex)
          throw new SamiteError("hash_mismatch", "The API hashed the reason differently; nothing was signed.")
      }
      const ix = await actions.rejectDelivery(ctx, {
        poster: o.signer,
        job: address(pda),
        machine: j.worker.value,
        reasonHash: local.hash,
      })
      const last = j.deliveries >= LIMITS.maxDeliveries
      return send(
        [ix],
        {
          action: "reject",
          job: pda,
          usdc: last ? { refund: j.reward.toString() } : {},
          lines: [
            last
              ? `Last allowed delivery: the full ${usdc(j.reward)} comes back to you.`
              : "The machine keeps the job and may deliver again. Your reason is public.",
          ],
        },
        opts,
      )
    },
  }

  return {
    address: me,
    request,
    jobs,
    deliveries,
    reviews,
    /** Jobs this address posted, and jobs it works on. */
    async mine() {
      const [posted, working] = await Promise.all([
        request<{ jobs: unknown[] }>("GET", `/api/v1/jobs?poster=${me}&status=all&limit=100`, undefined, false),
        request<{ jobs: unknown[] }>("GET", `/api/v1/jobs?worker=${me}&status=all&limit=100`, undefined, false),
      ])
      return { posted: posted.jobs, working: working.jobs }
    },
    /** SOL (lamports) and USDC (base units) of this machine. */
    async balance() {
      const sol = (await o.rpc.getBalance(me, { commitment: "confirmed" }).send()).value
      const accounts = await o.rpc
        .getTokenAccountsByOwner(me, { mint: ctx.usdcMint }, { encoding: "jsonParsed", commitment: "confirmed" })
        .send()
      const usdcAmount = accounts.value.reduce(
        (n, a) =>
          n +
          BigInt(
            (a.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount
              .amount,
          ),
        0n,
      )
      return { sol, usdc: usdcAmount }
    },
  }
}

export type Samite = ReturnType<typeof createSamite>
