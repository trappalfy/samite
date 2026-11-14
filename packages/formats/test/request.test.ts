import { describe, expect, it } from "vitest"
import { formatAuthorization, parseAuthorization, requestMessage } from "../src/request"

// CLAUDE.md §6.1 signed requests: sig = ed25519 over
// "samite:v1\n<METHOD>\n<path?query>\n<ts>\n<hex sha256 of body>".
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" // sha256("")

describe("requestMessage", () => {
  it("is the exact string the spec gives (vectors)", () => {
    expect(
      requestMessage({
        method: "get",
        pathAndQuery: "/api/v1/jobs/0415/delivery",
        ts: 1_800_000_000,
        body: new Uint8Array(),
      }),
    ).toBe(`samite:v1\nGET\n/api/v1/jobs/0415/delivery\n1800000000\n${EMPTY}`)
    const body = new TextEncoder().encode('{"v":"samite/job@1"}')
    expect(requestMessage({ method: "POST", pathAndQuery: "/api/v1/specs?dry=1", ts: 1_800_000_060, body })).toBe(
      "samite:v1\nPOST\n/api/v1/specs?dry=1\n1800000060\n53ddf7ba02548ba9fe1585d539560746e2a312a2416c490062824f605ea04d52",
    )
  })

  it("hashes the body bytes exactly: one changed byte, a different message", () => {
    const a = requestMessage({ method: "POST", pathAndQuery: "/x", ts: 1, body: new TextEncoder().encode("{}") })
    const b = requestMessage({ method: "POST", pathAndQuery: "/x", ts: 1, body: new TextEncoder().encode("{ }") })
    expect(a).not.toBe(b)
    expect(a.split("\n")[4]).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a") // sha256("{}")
  })

  it("refuses a path that isn't absolute or carries a newline", () => {
    expect(() =>
      requestMessage({ method: "GET", pathAndQuery: "api/v1/jobs", ts: 1, body: new Uint8Array() }),
    ).toThrow()
    expect(() => requestMessage({ method: "GET", pathAndQuery: "/a\n/b", ts: 1, body: new Uint8Array() })).toThrow()
    expect(() => requestMessage({ method: "GET", pathAndQuery: "/a", ts: 1.5, body: new Uint8Array() })).toThrow()
  })
})

describe("the Authorization header", () => {
  const sig = "5".repeat(87)
  const address = "9B6oPeqPKzRQXK2W2fJEUgRDxFC4PYrRthseKW8BeJde"

  it("round-trips", () => {
    const h = formatAuthorization({ address, ts: 1_800_000_000, sig })
    expect(h).toBe(`Samite-Ed25519 address=${address}, ts=1800000000, sig=${sig}`)
    expect(parseAuthorization(h)).toEqual({ address, ts: 1_800_000_000, sig })
  })

  it("accepts the parameters in any order and with or without spaces", () => {
    expect(parseAuthorization(`Samite-Ed25519 sig=${sig},address=${address},  ts=1800000000`)).toEqual({
      address,
      ts: 1_800_000_000,
      sig,
    })
  })

  it("refuses anything else", () => {
    for (const h of [
      "",
      "Bearer x",
      `Samite-Ed25519 address=${address}, ts=1800000000`,
      `Samite-Ed25519 address=${address}, ts=1800000000, sig=${sig}, sig=${sig}`,
      `Samite-Ed25519 address=${address}, ts=18e8, sig=${sig}`,
      `Samite-Ed25519 address=${address}, ts=-1, sig=${sig}`,
      `Samite-Ed25519 address=not-base58-0OIl, ts=1800000000, sig=${sig}`,
      `Samite-Ed25519 address=${address}, ts=1800000000, sig=${sig}, extra=1`,
    ])
      expect(parseAuthorization(h), h).toBeNull()
  })
})
