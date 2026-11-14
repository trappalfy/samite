import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { uploadTarget } from "@/lib/server/work"

// POST /api/v1/deliveries/upload { job, name, bytes }: signed, the job's machine. A short-lived upload URL for one file.
export const POST = handler(async (c) => {
  const { address } = await c.auth()
  return json(await uploadTarget(c.s, address, c.json(), c.s.origin(c.req)), { status: 201 })
})
