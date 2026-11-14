import { describe, expect, it } from "vitest"
import { contentSecurityPolicy, LOCKED_CSP, newNonce, originOf } from "@/lib/csp"

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `))
    ?.split(" ")
    .slice(1)

const base = {
  nonce: "abc123==",
  dev: false,
  production: true,
  rpcUrl: "https://mainnet.helius-rpc.com/?api-key=SECRET",
}

describe("contentSecurityPolicy", () => {
  it("runs scripts only by this request's nonce, and what they load", () => {
    const s = directive(contentSecurityPolicy(base), "script-src")!
    expect(s).toContain("'nonce-abc123=='")
    expect(s).toContain("'strict-dynamic'")
    expect(s).not.toContain("'unsafe-inline'")
    expect(s).not.toContain("'unsafe-eval'")
  })

  it("allows eval only in next dev", () => {
    expect(directive(contentSecurityPolicy({ ...base, dev: true }), "script-src")).toContain("'unsafe-eval'")
  })

  it("lets the page reach its RPC by origin only: the API key in the URL never lands in a header", () => {
    const csp = contentSecurityPolicy(base)
    expect(directive(csp, "connect-src")).toContain("https://mainnet.helius-rpc.com")
    expect(csp).not.toContain("SECRET")
  })

  it("allows the R2 endpoint when its account is configured, and nothing of R2 when not", () => {
    expect(directive(contentSecurityPolicy({ ...base, r2AccountId: "acc1" }), "connect-src")).toContain(
      "https://acc1.r2.cloudflarestorage.com",
    )
    expect(contentSecurityPolicy(base)).not.toContain("r2.cloudflarestorage.com")
  })

  it("allows Privy's frames and APIs (docs.privy.io's required domains)", () => {
    const csp = contentSecurityPolicy(base)
    expect(directive(csp, "frame-src")).toEqual(
      expect.arrayContaining(["https://auth.privy.io", "https://verify.walletconnect.com"]),
    )
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining(["https://auth.privy.io", "wss://relay.walletconnect.com", "https://*.rpc.privy.systems"]),
    )
    // the wallet icons in Privy's list (not in their documented policy; found by e2e/privy.manual.spec.ts)
    expect(directive(csp, "img-src")).toContain("https://explorer-api.walletconnect.com")
  })

  it("keeps the framing, plugin, base and form rules", () => {
    const csp = contentSecurityPolicy(base)
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"])
      expect(csp).toContain(d)
  })

  it("upgrades insecure requests on samite.fun only (locally the RPC is http://127.0.0.1)", () => {
    expect(contentSecurityPolicy(base)).toContain("upgrade-insecure-requests")
    const local = contentSecurityPolicy({ ...base, production: false, rpcUrl: "http://127.0.0.1:8899" })
    expect(local).not.toContain("upgrade-insecure-requests")
    expect(directive(local, "connect-src")).toContain("http://127.0.0.1:8899")
  })

  it("never puts an empty or undefined source in a directive", () => {
    const csp = contentSecurityPolicy({ ...base, rpcUrl: "not a url" })
    expect(csp).not.toMatch(/undefined|false|  |; ;/)
  })
})

describe("newNonce", () => {
  it("is 16 random bytes in the base64 form Next.js reads back, and fresh each time", () => {
    const a = newNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(newNonce()).not.toBe(a)
  })
})

describe("originOf", () => {
  it("drops the path and the query", () => {
    expect(originOf("https://rpc.example.com:8443/v1?api-key=x")).toBe("https://rpc.example.com:8443")
  })
  it("refuses what isn't http(s)", () => {
    expect(originOf("javascript:alert(1)")).toBeUndefined()
    expect(originOf("")).toBeUndefined()
  })
})

it("the gate's own responses load nothing", () => {
  expect(LOCKED_CSP).toContain("default-src 'none'")
})
