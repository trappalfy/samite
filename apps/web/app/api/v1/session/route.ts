import { handler, stringField } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { authenticate, closeSession, openSession, SESSION_COOKIE, sessionCookie } from "@/lib/server/session"

// GET: who is signed in. POST { address, signedMessage, signature } (base64): opens a session. DELETE: signs out.
export const GET = handler(async ({ req, s, body }) => {
  try {
    const who = await authenticate(req, body, s.session(req))
    return json({ address: who.address })
  } catch {
    return json({ address: null })
  }
})

export const POST = handler(async ({ req, s, json: read }) => {
  const b = read<Record<string, unknown>>()
  const r = await openSession(s.session(req), {
    address: stringField(b.address, "address"),
    signedMessage: stringField(b.signedMessage, "signedMessage"),
    signature: stringField(b.signature, "signature"),
  })
  return json(
    { address: r.address },
    { status: 201, headers: { "set-cookie": sessionCookie(r.cookie, r.expiresAt, s.production) } },
  )
})

export const DELETE = handler(async ({ req, s }) => {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1]
  await closeSession(s.session(req), token)
  return json(
    { address: null },
    { headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } },
  )
})
