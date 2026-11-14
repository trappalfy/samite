import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { storeRejection } from "@/lib/server/work"

// POST /api/v1/jobs/:ref/rejection { reason }: signed, poster. Stores the public reason; returns reason_hash.
export const POST = handler<{ ref: string }>(async (c, { ref }) => {
  const { address } = await c.auth()
  return json(await storeRejection(c.s, address, ref, c.json()), { status: 201 })
})
