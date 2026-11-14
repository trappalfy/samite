import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { signInChallenge } from "@/lib/server/session"

// POST /api/v1/session/challenge: the Sign-In With Solana input for the wallet to sign (one-time nonce, 10 minutes).
export const POST = handler(async ({ req, s }) =>
  json(await signInChallenge(s.session(req)), { headers: { "cache-control": "no-store" } }),
)
