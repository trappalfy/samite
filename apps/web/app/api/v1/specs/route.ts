import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { storeSpec } from "@/lib/server/work"

// POST /api/v1/specs { spec }: signed. Validates, canonicalises, hashes and moderates (§5.1, §12). Required before post.
export const POST = handler(async (c) => {
  const { via } = await c.auth()
  const b = c.json<{ spec?: unknown }>()
  const r = await storeSpec(c.s, b.spec ?? b, via === "session" ? "app" : "api")
  return json(r, { status: r.verdict === "pass" ? 201 : 200 })
})
