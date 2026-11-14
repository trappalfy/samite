import { describe, expect, it, vi } from "vitest"
import type { RpcTransport } from "@solana/kit"
import { failover } from "../lib/wallet/failover"

const ok = (name: string) => vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: name })) as unknown as RpcTransport
const failing = (status: number) =>
  vi.fn(async () => {
    throw new Error(`HTTP ${status}`)
  }) as unknown as RpcTransport
const call = (t: RpcTransport, signal?: AbortSignal) =>
  t<string>({ payload: { jsonrpc: "2.0", method: "getSlot", params: [] }, signal })

describe("failover", () => {
  it("uses the first RPC while it answers", async () => {
    const a = ok("a")
    const b = ok("b")
    expect(await call(failover([a, b]))).toMatchObject({ result: "a" })
    expect(b).not.toHaveBeenCalled()
  })

  it("sends the same request to the next one when the first fails, and says so", async () => {
    const a = failing(403)
    const b = ok("b")
    const onFail = vi.fn()
    expect(await call(failover([a, b], { onFail }))).toMatchObject({ result: "b" })
    expect(onFail).toHaveBeenCalledWith(0, expect.any(Error))
    expect((b as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual(
      (a as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0],
    )
  })

  it("skips an RPC that failed for a minute, then tries it again", async () => {
    let t = 0
    const a = failing(403)
    const b = ok("b")
    const f = failover([a, b], { now: () => t })
    await call(f)
    t = 59_999
    await call(f)
    expect(a).toHaveBeenCalledTimes(1)
    t = 60_000
    await call(f)
    expect(a).toHaveBeenCalledTimes(2)
  })

  it("throws the last error when every RPC fails, and doesn't retry an aborted request", async () => {
    await expect(call(failover([failing(403), failing(429)]))).rejects.toThrow("HTTP 429")
    const c = new AbortController()
    c.abort()
    const b = ok("b")
    await expect(call(failover([failing(500), b]), c.signal)).rejects.toThrow("HTTP 500")
    expect(b).not.toHaveBeenCalled()
  })
})
