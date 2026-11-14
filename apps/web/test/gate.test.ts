import { describe, expect, it } from "vitest"
import { accessToken, decide, MIN_KEY_LENGTH } from "../lib/gate"

// samite.fun before launch (lib/gate.ts): closed to everyone without the access key, on every request.
const KEY = "a".repeat(20) + "B".repeat(20) // 40 characters
const CLOSED = { VERCEL_ENV: "production", SAMITE_ACCESS_KEY: KEY }
const at = (path: string, extra: { cookie?: string; header?: string } = {}) => {
  const u = new URL(path, "https://samite.fun")
  return { pathname: u.pathname, search: u.searchParams, ...extra }
}

describe("the gate before launch", () => {
  it("is open off production (previews, local runs) and once the owner sets SAMITE_PUBLIC=1", async () => {
    expect(await decide(at("/jobs"), { VERCEL_ENV: "preview" })).toEqual({ kind: "open" })
    expect(await decide(at("/jobs"), {})).toEqual({ kind: "open" })
    expect(await decide(at("/jobs"), { ...CLOSED, SAMITE_PUBLIC: "1" })).toEqual({ kind: "open" })
  })

  it("answers nobody without the key: pages, the API, assets, images", async () => {
    for (const p of [
      "/",
      "/jobs",
      "/docs",
      "/api/v1/jobs",
      "/api/v1/health",
      "/_next/static/a.js",
      "/opengraph-image.png",
    ])
      expect(await decide(at(p), CLOSED), p).toEqual({ kind: "deny" })
  })

  it("lets robots.txt through: it says Disallow while closed", async () => {
    expect(await decide(at("/robots.txt"), CLOSED)).toEqual({ kind: "open" })
  })

  it("trades the secret link for a cookie and drops the key from the address", async () => {
    const d = await decide(at(`/jobs?sort=reward&access=${KEY}`), CLOSED)
    expect(d).toEqual({ kind: "grant", token: await accessToken(KEY), location: "/jobs?sort=reward" })
    expect((await decide(at(`/?access=${KEY}`), CLOSED)).kind).toBe("grant")
  })

  it("lets the cookie and the machines' header in, and nothing near them", async () => {
    const token = await accessToken(KEY)
    expect(token).not.toContain(KEY) // the cookie never holds the key itself
    expect(await decide(at("/jobs", { cookie: token }), CLOSED)).toEqual({ kind: "open" })
    expect(await decide(at("/api/v1/jobs", { header: KEY }), CLOSED)).toEqual({ kind: "open" })
    for (const bad of [
      at("/jobs", { cookie: KEY }), // the key is not the cookie
      at("/jobs", { cookie: token.slice(0, -1) + "0" }),
      at("/jobs", { header: token }), // the cookie is not the key
      at("/jobs", { header: KEY.slice(1) }),
      at(`/jobs?access=${KEY.toLowerCase()}`),
      at("/jobs?access="),
    ])
      expect(await decide(bad, CLOSED)).toEqual({ kind: "deny" })
  })

  it("stays closed to everyone if the key is missing or too short", async () => {
    const short = "x".repeat(MIN_KEY_LENGTH - 1)
    expect(await decide(at(`/?access=${short}`), { VERCEL_ENV: "production", SAMITE_ACCESS_KEY: short })).toEqual({
      kind: "deny",
    })
    expect(await decide(at("/", { header: "" }), { VERCEL_ENV: "production" })).toEqual({ kind: "deny" })
  })
})

describe("proxy", () => {
  it("sends a 404 and noindex to strangers, a cookie and a redirect for the secret link", async () => {
    const { NextRequest } = await import("next/server")
    const { proxy } = await import("../proxy")
    const was = { ...process.env }
    try {
      process.env.SAMITE_FORCE_PRODUCTION = "1"
      process.env.SAMITE_ACCESS_KEY = KEY
      delete process.env.SAMITE_PUBLIC
      const stranger = await proxy(new NextRequest("https://samite.fun/"))
      expect(stranger.status).toBe(404)
      expect(stranger.headers.get("x-robots-tag")).toBe("noindex, nofollow")
      const link = await proxy(new NextRequest(`https://samite.fun/?access=${KEY}`))
      expect(link.status).toBe(307)
      expect(link.headers.get("location")).toBe("https://samite.fun/")
      const cookie = link.cookies.get("samite_access")
      expect(cookie?.value).toBe(await accessToken(KEY))
      expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" })
      const back = await proxy(
        new NextRequest("https://samite.fun/jobs", { headers: { cookie: `samite_access=${cookie!.value}` } }),
      )
      expect(back.status).toBe(200)
      expect(back.headers.get("x-robots-tag")).toBe("noindex, nofollow")
      process.env.SAMITE_PUBLIC = "1"
      const launched = await proxy(new NextRequest("https://samite.fun/"))
      expect(launched.status).toBe(200)
      expect(launched.headers.get("x-robots-tag")).toBeNull()
    } finally {
      for (const k of ["SAMITE_FORCE_PRODUCTION", "SAMITE_ACCESS_KEY", "SAMITE_PUBLIC"])
        if (was[k] === undefined) delete process.env[k]
        else process.env[k] = was[k]
    }
  })
})
