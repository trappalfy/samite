import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { jobDetail } from "@/lib/server/jobs"

// GET /api/v1/jobs/:ref: state from the index + spec + poster record + history. The browser re-checks the chain.
export const GET = handler<{ ref: string }>(async ({ s }, { ref }) => json(await jobDetail(s.db, ref)))
