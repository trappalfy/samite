import { NextResponse, type NextRequest } from "next/server"
import { contentSecurityPolicy, LOCKED_CSP, newNonce } from "./lib/csp"
import { isClosed, isProduction } from "./lib/env"
import { ACCESS_COOKIE, ACCESS_HEADER, ACCESS_MAX_AGE, decide } from "./lib/gate"
import { BROWSER_RPC_URL } from "./lib/rpc-url"

// Every request passes here: the gate (lib/gate.ts: before launch, samite.fun answers only the team) and the
// Content-Security-Policy with this request's nonce (lib/csp.ts).
// SAMITE_CSP_REPORT_ONLY=1 sends the policy as Report-Only (the browser logs what it would block and blocks nothing):
// the way back if a wallet or Privy turns out to need something the policy forbids, without a code change.
export async function proxy(request: NextRequest) {
  const d = await decide({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.searchParams,
    cookie: request.cookies.get(ACCESS_COOKIE)?.value,
    header: request.headers.get(ACCESS_HEADER) ?? undefined,
  })
  const cspHeader =
    process.env.SAMITE_CSP_REPORT_ONLY === "1" ? "content-security-policy-report-only" : "content-security-policy"
  let res: NextResponse
  if (d.kind === "open") {
    const csp = contentSecurityPolicy({
      nonce: newNonce(),
      dev: process.env.NODE_ENV === "development",
      production: isProduction(),
      rpcUrl: BROWSER_RPC_URL,
      r2AccountId: process.env.R2_ACCOUNT_ID || undefined,
    })
    // Next.js reads the nonce from the request's policy and puts it on the scripts it renders
    const headers = new Headers(request.headers)
    headers.delete("content-security-policy")
    headers.delete("content-security-policy-report-only")
    headers.set(cspHeader, csp)
    res = NextResponse.next({ request: { headers } })
    res.headers.set(cspHeader, csp)
    return closedTags(res)
  }
  if (d.kind === "grant") {
    res = NextResponse.redirect(new URL(d.location, request.url))
    res.cookies.set(ACCESS_COOKIE, d.token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ACCESS_MAX_AGE,
    })
  } else
    res = new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    })
  res.headers.set("content-security-policy", LOCKED_CSP)
  return closedTags(res)
}

// nothing is indexed before launch, even pages the team can see
function closedTags(res: NextResponse) {
  if (isClosed()) res.headers.set("x-robots-tag", "noindex, nofollow")
  return res
}
