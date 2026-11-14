import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { feed } from "@/lib/server/jobs"

// GET /api/v1/events?cursor=<event id>&limit: the live feed, oldest first after the cursor (the newest page without one).
export const GET = handler(async ({ req, s }) => {
  const q = new URL(req.url).searchParams
  const after = q.has("cursor") ? Number(q.get("cursor")) : undefined
  return json(
    await feed(s.db, {
      after: Number.isSafeInteger(after) ? after : undefined,
      limit: q.has("limit") ? Number(q.get("limit")) : undefined,
    }),
  )
})
