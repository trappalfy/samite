import { describe, expect, it } from "vitest"
import { ownRpcUrl } from "@/lib/rpc-url"

// samite.fun's NEXT_PUBLIC_RPC_URL held a bare Helius key (Nov 15): the browser took it for a relative path and sent
// its RPC calls, key included, to samite.fun itself, which answered 404. Only a full http(s) URL is used now.
describe("ownRpcUrl", () => {
  it("takes a full http(s) URL as it is", () => {
    const helius = "https://mainnet.helius-rpc.com/?api-key=00000000-0000-0000-0000-000000000000"
    expect(ownRpcUrl(helius)).toBe(helius)
    expect(ownRpcUrl("http://127.0.0.1:8899")).toBe("http://127.0.0.1:8899")
  })

  it("is the local validator when the variable is unset", () => {
    expect(ownRpcUrl(undefined)).toBe("http://127.0.0.1:8899")
    expect(ownRpcUrl("")).toBe("http://127.0.0.1:8899")
  })

  it("refuses anything else, so no request goes to a relative path", () => {
    expect(ownRpcUrl("00000000-0000-0000-0000-000000000000")).toBeNull()
    expect(ownRpcUrl("mainnet.helius-rpc.com/?api-key=x")).toBeNull()
    expect(ownRpcUrl('"https://mainnet.helius-rpc.com/?api-key=x"')).toBeNull()
    expect(ownRpcUrl("wss://mainnet.helius-rpc.com/?api-key=x")).toBeNull()
  })
})
