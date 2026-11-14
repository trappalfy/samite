import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { stats } from "@/lib/server/jobs"

// GET /api/v1/stats: open jobs, USDC in escrow, paid in 24 h, jobs settled per hour over 24 h.
export const GET = handler(async ({ s }) =>
  json(await stats(s.db, Math.floor(Date.now() / 1000)), { headers: { "cache-control": "public, max-age=15" } }),
)
