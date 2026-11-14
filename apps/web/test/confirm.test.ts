import { afterEach, describe, expect, it, vi } from "vitest"
import { SolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/kit"

// The owner's post (Nov 14) went through on mainnet, but the page said "Solana error #8100002…": the browser's RPC key
// answered with an HTTP error while the page waited for the confirmation. Now the server confirms instead, and an
// RPC error is put into words.
const httpError = (statusCode: number) =>
  new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: "x", statusCode })

const browser = { fail: 0 }
vi.mock("../lib/wallet/client", () => ({
  browserRpc: () => ({
    getSignatureStatuses: () => ({
      send: async () => {
        if (browser.fail) throw httpError(browser.fail)
        return { value: [{ err: null, confirmationStatus: "confirmed" }] }
      },
    }),
  }),
}))

const { errorText } = await import("../lib/wallet/errors")
const { confirmed } = await import("../lib/wallet/send")

afterEach(() => {
  vi.unstubAllGlobals()
  browser.fail = 0
})

describe("errorText", () => {
  it("names the HTTP status instead of kit's bare code", () => {
    expect(errorText(httpError(403))).toBe("This page couldn't reach Solana's RPC (HTTP 403).")
    expect(errorText(httpError(429))).toBe("Solana's RPC is busy (HTTP 429). Try again in a minute.")
    expect(errorText(new Error("plain"))).toBe("plain")
  })
})

describe("confirmed", () => {
  it("uses the browser's RPC when it answers", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await expect(confirmed("sig", 5_000)).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("asks Samite's server when the browser's RPC refuses, and resolves once it is confirmed", async () => {
    browser.fail = 403
    vi.spyOn(console, "error").mockImplementation(() => {})
    const replies = [
      { status: "processed", err: null },
      { status: "confirmed", err: null },
    ]
    const fetch = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(JSON.stringify(replies.shift() ?? replies[0]), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetch)
    await expect(confirmed("5sig", 10_000)).resolves.toBeUndefined()
    expect(fetch.mock.calls[0]![0]).toBe("/api/v1/tx/status?signature=5sig")
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("still reports a transaction that failed on-chain", async () => {
    browser.fail = 403
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "confirmed", err: { InstructionError: [0, "x"] } }))),
    )
    await expect(confirmed("5sig", 5_000)).rejects.toThrow("The transaction failed on-chain; nothing changed.")
  })
})
