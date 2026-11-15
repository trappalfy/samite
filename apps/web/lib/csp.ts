// The Content-Security-Policy of every response (SECURITY-REVIEW R3), set by proxy.ts with a fresh nonce per request.
// Scripts run only if they carry this request's nonce or were loaded by one that does ('strict-dynamic'): Next.js puts
// the nonce on its own scripts (it reads it from the request's CSP header), the root layout on its one inline script.
// An injected <script>, an inline event handler or a javascript: URL doesn't run. Every page is rendered per request
// for this (the root layout reads the nonce), so no page is served from a build-time HTML file without one.
//
// Where the page may connect: itself, the browser's RPC (NEXT_PUBLIC_RPC_URL) and the public RPCs it falls back to
// (lib/rpc-url.ts), the R2 endpoint (the job page's
// delivery preview), and Privy. Privy's list is from docs.privy.io/security/implementation-guide/content-security-policy
// (read Nov 14, 2026): the required domains, Cloudflare Turnstile (in their example policy), and Solana's public RPC,
// which they list for apps that don't give Privy their own (Samite doesn't). Re-check it at every Privy upgrade.

import { PUBLIC_RPC_URLS } from "./rpc-url"

const PRIVY_FRAMES = ["https://auth.privy.io", "https://verify.walletconnect.com", "https://verify.walletconnect.org"]
const PRIVY_CONNECT = [
  "https://auth.privy.io",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "wss://www.walletlink.org",
  "https://*.rpc.privy.systems",
  "https://explorer-api.walletconnect.com",
  "https://api.mainnet-beta.solana.com",
]
const TURNSTILE = "https://challenges.cloudflare.com"
// the wallet icons in Privy's list (Phantom, Solflare, Backpack): not in Privy's documented policy, found by
// e2e/privy.manual.spec.ts, which fails on any blocked request
const PRIVY_IMAGES = ["https://explorer-api.walletconnect.com"]

export type CspOptions = {
  nonce: string
  /** `next dev`: React needs eval for its error overlays. */
  dev: boolean
  /** samite.fun: upgrade any http:// subresource (never wanted there; locally the RPC is http://127.0.0.1). */
  production: boolean
  rpcUrl: string
  r2AccountId?: string
}

/** The origin (scheme://host[:port]) of a URL, without its path or query: an RPC URL's query holds its API key. */
export function originOf(url: string): string | undefined {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : undefined
  } catch {
    return undefined
  }
}

/** 16 random bytes, base64: the form Next.js reads back from the header (get-script-nonce-from-header.js). */
export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

export function contentSecurityPolicy(o: CspOptions): string {
  const connect = [
    "'self'",
    originOf(o.rpcUrl),
    ...PUBLIC_RPC_URLS,
    o.r2AccountId && `https://${o.r2AccountId}.r2.cloudflarestorage.com`,
  ]
  const directives: [string, ...(string | false | undefined)[]][] = [
    ["default-src", "'self'"],
    // 'self' and the host are ignored by browsers that know 'strict-dynamic'; older ones fall back to them
    ["script-src", "'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", TURNSTILE, o.dev && "'unsafe-eval'"],
    // React's style attributes and Privy's styled-components: styles can't run code
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", ...PRIVY_IMAGES],
    ["font-src", "'self'"],
    ["connect-src", ...connect, ...PRIVY_CONNECT],
    ["frame-src", ...PRIVY_FRAMES, TURNSTILE],
    ["child-src", ...PRIVY_FRAMES],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ]
  if (o.production) directives.push(["upgrade-insecure-requests"])
  return directives.map(([name, ...v]) => [name, ...v.filter(Boolean)].join(" ")).join("; ")
}

/** For responses that are never pages (the gate's 404 and redirect): nothing may load at all. */
export const LOCKED_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
