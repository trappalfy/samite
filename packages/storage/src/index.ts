// Where spec attachments and deliveries live (§7.1, §12): Cloudflare R2 in production, a folder locally. Uploads and
// downloads go through short-lived URLs; downloads are always attachments, never rendered inline. The server checks a
// file's sha256 by streaming it back, never trusting what the uploader says.
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

/** Delivered files are deleted this long after their job closes (§5.2; the privacy draft says 90 days). */
export const DELIVERY_RETENTION_SEC = 90 * 24 * 60 * 60

export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string }

export interface BlobStore {
  readonly kind: "fs" | "r2"
  /** A URL to PUT exactly `bytes` bytes to. */
  /** `origin` is the site the request came to (the local store serves its own URLs; R2 ignores it). */
  uploadUrl(key: string, o: { bytes: number; contentType: string; ttlSec: number; origin: string }): Promise<UploadTarget>
  /** A URL that downloads the object as an attachment named `filename`. */
  downloadUrl(key: string, o: { filename: string; ttlSec: number; origin: string }): Promise<string>
  /** The object's size and sha256 (hex), streamed; null if it isn't there. */
  inspect(key: string): Promise<{ bytes: number; sha256: string } | null>
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Object keys: lowercase letters, digits, and / . _ - only; no "..". Callers build them, never users. */
export function assertKey(key: string) {
  if (!/^[a-z0-9][a-z0-9/._-]{0,255}$/.test(key) || key.includes("..")) throw new Error(`bad storage key ${key}`)
}

const attachment = (filename: string) => `attachment; filename="${filename.replace(/[^\w.\- ]/g, "_")}"`

async function hashStream(s: AsyncIterable<Uint8Array>) {
  const h = createHash("sha256")
  let bytes = 0
  for await (const chunk of s) {
    h.update(chunk)
    bytes += chunk.length
  }
  return { bytes, sha256: h.digest("hex") }
}

// --- local folder ---------------------------------------------------------------------------------------------

export type BlobGrant = { op: "put" | "get"; key: string; exp: number; len?: number; ct?: string; name?: string }

const grantString = (g: BlobGrant) => [g.op, g.key, g.exp, g.len ?? "", g.ct ?? "", g.name ?? ""].join("\n")
const mac = (secret: string, g: BlobGrant) => createHmac("sha256", secret).update(grantString(g)).digest("base64url")

/** Signs a grant for the local blob route (/api/v1/blobs/…). */
export function signGrant(secret: string, g: BlobGrant): URLSearchParams {
  const p = new URLSearchParams({ op: g.op, exp: String(g.exp), sig: mac(secret, g) })
  if (g.len !== undefined) p.set("len", String(g.len))
  if (g.ct) p.set("ct", g.ct)
  if (g.name) p.set("name", g.name)
  return p
}

/** The grant a local blob URL carries, if its signature is good and it hasn't expired. */
export function readGrant(secret: string, key: string, q: URLSearchParams, now = Date.now()): BlobGrant | null {
  const op = q.get("op")
  if (op !== "put" && op !== "get") return null
  const g: BlobGrant = { op, key, exp: Number(q.get("exp")) }
  if (q.has("len")) g.len = Number(q.get("len"))
  if (q.get("ct")) g.ct = q.get("ct")!
  if (q.get("name")) g.name = q.get("name")!
  const want = Buffer.from(mac(secret, g)),
    got = Buffer.from(q.get("sig") ?? "")
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return g.exp * 1000 > now ? g : null
}

export function fsStore(o: {
  dir: string
  secret: string
  now?: () => number
}): BlobStore & { path(key: string): string } {
  const root = resolve(o.dir)
  const path = (key: string) => {
    assertKey(key)
    const p = resolve(root, key)
    if (!p.startsWith(root + sep)) throw new Error("key escapes the store")
    return p
  }
  const exp = (ttl: number) => Math.floor((o.now ?? Date.now)() / 1000) + ttl
  const url = (origin: string, key: string, p: URLSearchParams) => `${origin}/api/v1/blobs/${key}?${p}`
  return {
    kind: "fs",
    path,
    async uploadUrl(key, u) {
      path(key)
      const g: BlobGrant = { op: "put", key, exp: exp(u.ttlSec), len: u.bytes, ct: u.contentType }
      return {
        url: url(u.origin, key, signGrant(o.secret, g)),
        method: "PUT",
        headers: { "content-type": u.contentType },
        expiresAt: new Date(g.exp * 1000).toISOString(),
      }
    },
    async downloadUrl(key, d) {
      path(key)
      return url(d.origin, key, signGrant(o.secret, { op: "get", key, exp: exp(d.ttlSec), name: d.filename }))
    },
    async inspect(key) {
      try {
        await stat(path(key))
      } catch {
        return null
      }
      return hashStream(createReadStream(path(key)))
    },
    async put(key, bytes) {
      await mkdir(dirname(path(key)), { recursive: true })
      await writeFile(path(key), bytes)
    },
    async delete(key) {
      await rm(path(key), { force: true })
    },
  }
}

// --- Cloudflare R2 (S3 API) -----------------------------------------------------------------------------------

export function r2Store(o: {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}): BlobStore {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${o.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
  })
  const Bucket = o.bucket
  return {
    kind: "r2",
    async uploadUrl(key, u) {
      assertKey(key)
      // ContentLength is signed, so the upload must be exactly the declared size (the spec's limit is checked first)
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket, Key: key, ContentLength: u.bytes, ContentType: u.contentType }),
        { expiresIn: u.ttlSec },
      )
      return {
        url,
        method: "PUT",
        headers: { "content-type": u.contentType },
        expiresAt: new Date(Date.now() + u.ttlSec * 1000).toISOString(),
      }
    },
    async downloadUrl(key, d) {
      assertKey(key)
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: attachment(d.filename),
          ResponseContentType: "application/octet-stream",
        }),
        { expiresIn: d.ttlSec },
      )
    },
    async inspect(key) {
      assertKey(key)
      try {
        await s3.send(new HeadObjectCommand({ Bucket, Key: key }))
      } catch {
        return null
      }
      const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }))
      return hashStream(r.Body as Readable)
    },
    async put(key, bytes, contentType) {
      assertKey(key)
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType }))
    },
    async delete(key) {
      assertKey(key)
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },
  }
}

export { attachment as contentDisposition }
