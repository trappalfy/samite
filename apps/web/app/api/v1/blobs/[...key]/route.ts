import { createReadStream } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Readable } from "node:stream"
import { server } from "@/lib/server/context"
import { ApiError, errorResponse } from "@/lib/server/errors"
import { contentDisposition, readGrant } from "@/lib/server/storage"

// Local storage only (R2 serves its own presigned URLs in production): PUT uploads exactly the granted bytes,
// GET downloads as an attachment. Every URL carries an HMAC grant that expires.
async function local(req: Request, key: string[]) {
  const s = await server()
  if (s.store.kind !== "fs") throw new ApiError("not_found", "Not found.")
  const k = key.join("/")
  const grant = readGrant(s.session(req).secret, k, new URL(req.url).searchParams)
  if (!grant) throw new ApiError("forbidden", "This link has expired or isn't valid.")
  return { s, k, grant, path: (s.store as unknown as { path(key: string): string }).path(k) }
}

export async function PUT(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const { grant, path } = await local(req, (await ctx.params).key)
    if (grant.op !== "put") throw new ApiError("forbidden", "This link is for downloading.")
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length !== grant.len) throw new ApiError("bad_request", `Upload exactly ${grant.len} bytes.`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    return new Response(null, { status: 200 })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const { grant, path } = await local(req, (await ctx.params).key)
    if (grant.op !== "get") throw new ApiError("forbidden", "This link is for uploading.")
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": contentDisposition(grant.name ?? "download"),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    })
  } catch (e) {
    return errorResponse(e)
  }
}
