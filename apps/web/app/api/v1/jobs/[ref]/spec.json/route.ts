import { eq } from "drizzle-orm"
import { schema } from "@samite/db"
import { handler } from "@/lib/server/http"
import { ApiError } from "@/lib/server/errors"
import { findJob } from "@/lib/server/jobs"

// GET /api/v1/jobs/:ref/spec.json: the exact canonical bytes whose sha256 is on-chain (§5.1). Re-hash them yourself.
export const GET = handler<{ ref: string }>(async ({ s }, { ref }) => {
  const j = await findJob(s.db, ref)
  const [spec] = await s.db.select().from(schema.specs).where(eq(schema.specs.specHash, j.specHash))
  if (!spec) throw new ApiError("not_found", "No stored spec for this job.")
  return new Response(new Uint8Array(spec.canonical), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "x-spec-sha256": spec.specHash,
    },
  })
})
