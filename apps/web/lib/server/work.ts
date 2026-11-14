// The write side the chain doesn't see: specs (POST /specs), delivery files and manifests (POST /deliveries/upload,
// POST /deliveries, GET /jobs/:ref/delivery) and rejection reasons (POST /jobs/:ref/rejection). Each is stored before
// its hash goes on-chain, and each check about who may act reads the job from the chain.
import { randomBytes } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { address, isSome, type Address } from "@solana/kit"
import { schema } from "@samite/db"
import {
  deliveryHash,
  FORMAT_LIMITS,
  parseDelivery,
  parseJobSpec,
  parseRejectionReason,
  reasonHash,
  specHash,
  type JobSpec,
} from "@samite/formats"
import { fetchMaybeJob, JobStatus, type Job } from "@samite/program-client"
import type { Server } from "./context"
import { ApiError } from "./errors"
import { stringField } from "./http"
import { findJob } from "./jobs"

export async function storeSpec(s: Server, input: unknown, via: "app" | "api") {
  const r = parseJobSpec(input)
  if (!r.ok) throw new ApiError("spec_invalid", "The spec doesn't follow samite/job@1.", { errors: r.errors })
  const h = specHash(r.spec)
  const [existing] = await s.db.select().from(schema.specs).where(eq(schema.specs.specHash, h.hex))
  let verdict = existing?.verdict
  let reasons = existing?.reasons ?? []
  if (!existing || existing.verdict === "pending") {
    const m = await s.moderator.check(r.spec)
    verdict = m.verdict
    reasons = m.reasons
    if (existing) await s.db.update(schema.specs).set({ verdict, reasons }).where(eq(schema.specs.specHash, h.hex))
    else
      await s.db.insert(schema.specs).values({
        specHash: h.hex,
        canonical: h.canonical,
        title: r.spec.title,
        category: r.spec.category,
        json: r.spec,
        verdict,
        reasons,
        postedFrom: via,
      })
  }
  return {
    spec_hash: h.hex,
    canonical: Buffer.from(h.canonical).toString("base64"),
    warnings: r.warnings,
    verdict,
    reasons,
  }
}

async function chainJob(s: Server, pda: string): Promise<Job> {
  const a = await fetchMaybeJob(s.rpc, address(pda), { commitment: "confirmed" })
  if (!a.exists) throw new ApiError("chain_state", "This job is closed on-chain.")
  return a.data
}

async function specOf(s: Server, hash: string): Promise<JobSpec | null> {
  const [spec] = await s.db.select().from(schema.specs).where(eq(schema.specs.specHash, hash))
  return (spec?.json as JobSpec | undefined) ?? null
}

/** The machine working on the job, now, on-chain; and the job's index row and spec. */
async function asWorker(s: Server, caller: Address, ref: string) {
  const row = await findJob(s.db, ref, { includeHidden: true })
  const j = await chainJob(s, row.pda)
  if (!(isSome(j.worker) && j.worker.value === caller) || j.status !== JobStatus.Claimed)
    throw new ApiError("forbidden", "Only the machine working on this job can deliver, while it holds the claim.")
  return { row, j, spec: await specOf(s, row.specHash) }
}

const safeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 80) || "file"

/** A short-lived URL to upload one delivery file to, sized by the spec. */
export async function uploadTarget(s: Server, caller: Address, b: Record<string, unknown>, origin: string) {
  const { row, j, spec } = await asWorker(s, caller, stringField(b.job, "job"))
  if (spec && spec.deliverable.kind !== "file")
    throw new ApiError("delivery_invalid", `This job takes a ${spec.deliverable.kind} delivery, not files.`)
  const max = spec?.deliverable.kind === "file" ? spec.deliverable.max_bytes : FORMAT_LIMITS.delivery.fileMaxBytes
  const bytes = Number(b.bytes)
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new ApiError("bad_request", "bytes is the file's size.")
  if (bytes > max) throw new ApiError("payload_too_large", `This job takes files up to ${max} bytes.`)
  const name = stringField(b.name, "name")
  const key = `deliveries/${row.displayNo}/${j.deliveries + 1}/${randomBytes(6).toString("hex")}-${safeName(name)}`
  const upload = await s.store.uploadUrl(key, { bytes, contentType: "application/octet-stream", ttlSec: 900, origin })
  return { key, name, bytes, upload }
}

/** Checks a manifest against the job, the spec and the stored files (re-hashed here), stores it, returns its hash. */
export async function storeDelivery(s: Server, caller: Address, b: Record<string, unknown>) {
  const ref = stringField(b.job, "job")
  const { row, j, spec } = await asWorker(s, caller, ref)
  const r = parseDelivery(b.manifest)
  if (!r.ok)
    throw new ApiError("delivery_invalid", "The manifest doesn't follow samite/delivery@1.", { errors: r.errors })
  const d = r.delivery
  if (d.job !== row.pda) throw new ApiError("delivery_invalid", "manifest.job is not this job's address.")
  if (d.attempt !== j.deliveries + 1)
    throw new ApiError("delivery_invalid", `This is delivery ${j.deliveries + 1}; manifest.attempt says ${d.attempt}.`)
  if (spec && spec.deliverable.kind !== d.kind)
    throw new ApiError("delivery_invalid", `This job takes a ${spec.deliverable.kind} delivery.`)

  const keys: string[] = []
  if (d.kind === "file") {
    const uploads = Array.isArray(b.files) ? (b.files as { name?: unknown; key?: unknown }[]) : []
    const prefix = `deliveries/${row.displayNo}/${d.attempt}/`
    let total = 0
    for (const f of d.files) {
      const u = uploads.find((x) => x.name === f.name)
      if (!u || typeof u.key !== "string" || !u.key.startsWith(prefix))
        throw new ApiError("delivery_invalid", `No upload for ${f.name} on this delivery (files: [{ name, key }]).`)
      const got = await s.store.inspect(u.key)
      if (!got) throw new ApiError("delivery_invalid", `${f.name} hasn't been uploaded yet.`)
      if (got.bytes !== f.bytes || got.sha256 !== f.sha256)
        throw new ApiError(
          "hash_mismatch",
          `${f.name}: stored ${got.bytes} bytes, sha256 ${got.sha256}; the manifest says ${f.bytes}, ${f.sha256}.`,
        )
      total += got.bytes
      keys.push(u.key)
    }
    const max = spec?.deliverable.kind === "file" ? spec.deliverable.max_bytes : FORMAT_LIMITS.delivery.fileMaxBytes
    if (total > max)
      throw new ApiError("payload_too_large", `This delivery is ${total} bytes; the job takes up to ${max}.`)
  }
  const h = deliveryHash(d)
  await s.db
    .insert(schema.deliveries)
    .values({
      jobPda: row.pda,
      jobNo: row.displayNo,
      attempt: d.attempt,
      worker: caller,
      manifest: d,
      deliveryHash: h.hex,
      storageKeys: keys,
    })
    .onConflictDoNothing()
  return { delivery_hash: h.hex, attempt: d.attempt }
}

/**
 * Deliveries for their poster and their machine only (§5.2): manifest, short-lived download links, the chain check.
 * The poster sees every delivery of the job; a machine sees only the ones it submitted (also after it left the job),
 * never another machine's: a job can change hands after a rejection.
 */
export async function readDelivery(s: Server, caller: Address, ref: string, origin: string) {
  const row = await findJob(s.db, ref, { includeHidden: true })
  const isPoster = caller === row.poster
  const all = await s.db
    .select()
    .from(schema.deliveries)
    .where(eq(schema.deliveries.jobNo, row.displayNo))
    .orderBy(desc(schema.deliveries.attempt))
  const submitted = all.filter((d) => d.submittedSig && (isPoster || d.worker === caller))
  if (!isPoster && caller !== row.worker && submitted.length === 0)
    throw new ApiError("forbidden", "Only the poster and the machine that delivered can see a delivery.")
  return {
    job: row.pda,
    on_chain_hash: row.deliveryHash,
    deliveries: await Promise.all(
      submitted.map(async (d) => {
        // deleted 90 days after the job closed (apps/worker/src/purge.ts): the record and the hash, nothing else
        if (d.prunedAt)
          return {
            attempt: d.attempt,
            delivery_hash: d.deliveryHash,
            sig: d.submittedSig,
            matches_chain: d.deliveryHash === row.deliveryHash,
            manifest: d.manifest,
            files: [],
            files_deleted: true,
            deleted: true,
          }
        const manifest = d.manifest as { kind: string; files?: { name: string }[] }
        const files =
          manifest.kind === "file"
            ? await Promise.all(
                (manifest.files ?? []).map(async (f, i) => ({
                  name: f.name,
                  // null once the files are deleted (DELIVERY_RETENTION_SEC after the job closed)
                  url: d.storageKeys[i]
                    ? await s.store.downloadUrl(d.storageKeys[i], { filename: f.name, ttlSec: 300, origin })
                    : null,
                })),
              )
            : []
        return {
          attempt: d.attempt,
          delivery_hash: d.deliveryHash,
          sig: d.submittedSig,
          // the stored manifest re-hashes to this value; the job page compares it with the chain's own
          matches_chain: d.deliveryHash === row.deliveryHash,
          manifest: d.manifest,
          files,
          files_deleted: manifest.kind === "file" && d.storageKeys.length === 0,
        }
      }),
    ),
  }
}

/** Stores the poster's public reason before they sign reject_delivery (§5.3). */
export async function storeRejection(s: Server, caller: Address, ref: string, b: Record<string, unknown>) {
  const row = await findJob(s.db, ref, { includeHidden: true })
  const j = await chainJob(s, row.pda)
  if (j.poster !== caller) throw new ApiError("forbidden", "Only the poster can reject a delivery.")
  if (j.status !== JobStatus.Delivered) throw new ApiError("chain_state", "There's no delivery waiting for review.")
  const r = parseRejectionReason(b.reason)
  if (!r.ok) throw new ApiError("reason_invalid", "A reason is 10 to 1,000 characters.", { errors: r.errors })
  const h = reasonHash(r.reason)
  const [dupe] = await s.db
    .select()
    .from(schema.rejections)
    .where(
      and(
        eq(schema.rejections.jobNo, row.displayNo),
        eq(schema.rejections.attempt, j.deliveries),
        eq(schema.rejections.reasonHash, h.hex),
      ),
    )
  if (!dupe)
    await s.db
      .insert(schema.rejections)
      .values({ jobPda: row.pda, jobNo: row.displayNo, attempt: j.deliveries, reason: r.reason, reasonHash: h.hex })
  return { reason_hash: h.hex, attempt: j.deliveries }
}
