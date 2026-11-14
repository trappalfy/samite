import { handler, bigintField } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { board } from "@/lib/server/jobs"

// GET /api/v1/jobs?status&category&posted_from=app|api&min_reward&sort=newest|reward|deadline&cursor&limit&poster&worker
export const GET = handler(async ({ req, s }) => {
  const q = new URL(req.url).searchParams
  const sort = q.get("sort") ?? "newest"
  if (!["newest", "reward", "deadline"].includes(sort))
    return json({ error: { code: "bad_request", message: "sort is newest, reward or deadline." } }, { status: 400 })
  return json(
    await board(s.db, {
      status: q.get("status") ?? undefined,
      category: q.get("category") ?? undefined,
      postedFrom: q.get("posted_from") ?? undefined,
      minReward: q.has("min_reward") ? bigintField(q.get("min_reward"), "min_reward") : undefined,
      sort: sort as "newest",
      cursor: q.get("cursor") ?? undefined,
      limit: q.has("limit") ? Number(q.get("limit")) : undefined,
      poster: q.get("poster") ?? undefined,
      worker: q.get("worker") ?? undefined,
    }),
  )
})
