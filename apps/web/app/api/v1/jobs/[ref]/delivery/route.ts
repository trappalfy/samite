import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { readDelivery } from "@/lib/server/work"

// GET /api/v1/jobs/:ref/delivery: signed, poster or the job's machine only (§5.2).
export const GET = handler<{ ref: string }>(async (c, { ref }) => {
  const { address } = await c.auth()
  return json(await readDelivery(c.s, address, ref, c.s.origin(c.req)), { headers: { "cache-control": "private, no-store" } })
})
