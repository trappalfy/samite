import { describe, expect, it } from "vitest"
import { DEFAULT_POLL_MS, indexerPollMs } from "../src/interval"

describe("INDEXER_POLL_MS", () => {
  it("defaults to 2 s when unset or empty", () => {
    expect(indexerPollMs(undefined)).toBe(DEFAULT_POLL_MS)
    expect(indexerPollMs("")).toBe(2_000)
    expect(indexerPollMs("  ")).toBe(2_000)
  })

  it("takes whole milliseconds from 1 s to 20 s", () => {
    expect(indexerPollMs("5000")).toBe(5_000)
    expect(indexerPollMs("1000")).toBe(1_000)
    expect(indexerPollMs("20000")).toBe(20_000)
  })

  it("refuses anything else, so a typo can't silently stop the indexer or flap /health", () => {
    for (const v of ["999", "20001", "5s", "5000.5", "-5000", "0", "abc"])
      expect(() => indexerPollMs(v), v).toThrow(/INDEXER_POLL_MS/)
  })
})
