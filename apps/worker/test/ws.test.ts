import { describe, expect, it } from "vitest"
import { wsUrlFor } from "../src/ws"

describe("wsUrlFor", () => {
  it("keeps the host and key, and follows the local validator's port", () => {
    expect(wsUrlFor("https://mainnet.helius-rpc.com/?api-key=k")).toBe("wss://mainnet.helius-rpc.com/?api-key=k")
    expect(wsUrlFor("http://127.0.0.1:8899")).toBe("ws://127.0.0.1:8900/")
  })
})
