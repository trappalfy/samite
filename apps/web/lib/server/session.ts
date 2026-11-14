// Sign-In With Solana (CLAUDE.md §6.1): in the browser, one wallet signature opens a session that replaces per-request
// signatures. The server issues the sign-in input (domain, nonce, times); the wallet signs it (`solana:signIn`, or
// `signMessage` over the same text as a fallback); the server checks every field and the signature, then sets an
// HttpOnly cookie. Only an HMAC of the token is stored, so a database leak opens no session.
import { createHmac, randomBytes } from "node:crypto"
import { and, eq, gt } from "drizzle-orm"
import { getPublicKeyFromAddress, isAddress, signatureBytes, verifySignature, type Address } from "@solana/kit"
import { createSignInMessageText, parseSignInMessageText } from "@solana/wallet-standard-util"
import { schema, type Db } from "@samite/db"
import { ApiError } from "./errors"
import type { Kv } from "./kv"
import { verifySignedRequest } from "./signed"

export const SESSION_COOKIE = "samite_session"
export const SESSION_DAYS = 7
const NONCE_TTL_SEC = 600

export type SessionConfig = {
  db: Db
  kv: Kv
  secret: string
  origin: string
  chainId: "mainnet" | "localnet"
  now?: () => number
}

/** The input the wallet signs. The wallet adds the address. */
export async function signInChallenge(c: SessionConfig) {
  const nonce = randomBytes(16).toString("hex")
  await c.kv.setOnce(`nonce:${nonce}`, NONCE_TTL_SEC)
  const now = (c.now ?? Date.now)()
  const url = new URL(c.origin)
  return {
    domain: url.host,
    uri: url.origin,
    statement: "Sign in to Samite. This signature costs nothing and moves no funds.",
    version: "1",
    chainId: c.chainId,
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + NONCE_TTL_SEC * 1000).toISOString(),
  }
}

/** The exact text a wallet without `solana:signIn` signs with `signMessage`. */
export const signInText = (input: Awaited<ReturnType<typeof signInChallenge>>, address: string) =>
  createSignInMessageText({ ...input, address })

const tokenId = (secret: string, token: string) => createHmac("sha256", secret).update(token).digest("hex")

/** Checks a signed sign-in and opens a session. Returns the cookie value and the address. */
export async function openSession(
  c: SessionConfig,
  body: { address: string; signedMessage: string; signature: string },
) {
  const text = Buffer.from(body.signedMessage, "base64").toString("utf8")
  const m = parseSignInMessageText(text)
  const url = new URL(c.origin)
  const now = (c.now ?? Date.now)()
  const fail = (why: string): never => {
    throw new ApiError("session_invalid", `Sign-in refused: ${why}.`)
  }
  if (!m) fail("the message is not a Sign-In With Solana message")
  if (m!.domain !== url.host) fail(`it was made for ${m!.domain}, not ${url.host}`)
  if (m!.uri && new URL(m!.uri).origin !== url.origin) fail("its URI is not this site")
  if (m!.address !== body.address || !isAddress(body.address)) fail("the address doesn't match")
  if (m!.chainId && m!.chainId !== c.chainId) fail(`it is for ${m!.chainId}, this site is on ${c.chainId}`)
  if (!m!.expirationTime || Date.parse(m!.expirationTime) <= now) fail("it has expired; sign in again")
  if (m!.issuedAt && Date.parse(m!.issuedAt) > now + 60_000) fail("it is dated in the future")

  let sig
  try {
    sig = signatureBytes(new Uint8Array(Buffer.from(body.signature, "base64")))
  } catch {
    fail("the signature is not 64 bytes")
  }
  const key = await getPublicKeyFromAddress(body.address as Address)
  if (!(await verifySignature(key, sig!, new TextEncoder().encode(text)))) fail("the signature doesn't match")
  // the nonce is spent last, so a bad attempt doesn't burn a good one
  if (!m!.nonce || (await c.kv.take(`nonce:${m!.nonce}`)) === null)
    fail("this sign-in was already used or never issued")

  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(now + SESSION_DAYS * 86_400_000)
  await c.db.insert(schema.sessions).values({ id: tokenId(c.secret, token), address: body.address, expiresAt })
  return { address: body.address as Address, cookie: token, expiresAt }
}

export async function closeSession(c: SessionConfig, token: string | undefined) {
  if (token) await c.db.delete(schema.sessions).where(eq(schema.sessions.id, tokenId(c.secret, token)))
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`
}

const cookieToken = (req: Request) =>
  req.headers
    .get("cookie")
    ?.split(";")
    .map((p) => p.trim().split("="))
    .find(([k]) => k === SESSION_COOKIE)?.[1]

const SAFE = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Who is calling: a signed request (machines, the SDK), else the session cookie (the browser). A cookie only counts for
 * a state-changing request that comes from this site (Origin check), so another site can't act with it.
 */
export async function authenticate(
  req: Request,
  body: Uint8Array,
  c: SessionConfig,
): Promise<{ address: Address; via: "signed" | "session" }> {
  if (req.headers.get("authorization"))
    return { address: await verifySignedRequest(req, body, { kv: c.kv, now: c.now }), via: "signed" }
  const token = cookieToken(req)
  if (!token) throw new ApiError("auth_missing", "Sign in with your wallet, or send a signed request.")
  if (!SAFE.has(req.method) && req.headers.get("origin") !== new URL(c.origin).origin)
    throw new ApiError("forbidden", "A session can only be used from this site.")
  const now = new Date((c.now ?? Date.now)())
  const [s] = await c.db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, tokenId(c.secret, token)), gt(schema.sessions.expiresAt, now)))
  if (!s) throw new ApiError("session_invalid", "Your session has ended. Sign in again.")
  return { address: s.address as Address, via: "session" }
}
