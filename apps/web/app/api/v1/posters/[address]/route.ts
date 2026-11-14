import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { posterRecord } from "@/lib/server/jobs"

// GET /api/v1/posters/:address: the poster's public record (§4.6).
export const GET = handler<{ address: string }>(async ({ s }, { address }) => json(await posterRecord(s.db, address)))
