import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { assertKey, fsStore, readGrant } from "../src/index"

const dir = mkdtempSync(join(tmpdir(), "samite-blobs-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const T = Date.parse("2026-11-12T12:00:00Z")
const store = fsStore({ dir, secret: "s", now: () => T })
const origin = "http://localhost:3000"
const params = (url: string) => new URL(url).searchParams

describe("local storage", () => {
  it("hands out an upload URL whose grant checks out, for exactly that key, size and type", async () => {
    const u = await store.uploadUrl("deliveries/j1/1/a.csv", { bytes: 12, contentType: "text/csv", ttlSec: 600, origin })
    expect(u.method).toBe("PUT")
    expect(readGrant("s", "deliveries/j1/1/a.csv", params(u.url), T)).toEqual({
      op: "put",
      key: "deliveries/j1/1/a.csv",
      exp: T / 1000 + 600,
      len: 12,
      ct: "text/csv",
    })
    expect(readGrant("s", "deliveries/j1/1/b.csv", params(u.url), T), "another key").toBeNull()
    const bigger = params(u.url)
    bigger.set("len", "13")
    expect(readGrant("s", "deliveries/j1/1/a.csv", bigger, T), "a bigger file").toBeNull()
    expect(readGrant("t", "deliveries/j1/1/a.csv", params(u.url), T), "another secret").toBeNull()
    expect(readGrant("s", "deliveries/j1/1/a.csv", params(u.url), T + 601_000), "expired").toBeNull()
  })

  it("hashes what is stored, not what anyone claims", async () => {
    await store.put("deliveries/j1/1/a.csv", new TextEncoder().encode("a,b\n1,2\n"), "text/csv")
    const want = createHash("sha256").update("a,b\n1,2\n").digest("hex")
    expect(await store.inspect("deliveries/j1/1/a.csv")).toEqual({ bytes: 8, sha256: want })
    expect(await store.inspect("deliveries/j1/1/missing.csv")).toBeNull()
  })

  it("never lets a key leave the folder", () => {
    for (const k of ["../x", "a/../../x", "/etc/passwd", "A.csv", "a b", ""]) expect(() => assertKey(k), k).toThrow()
    expect(() => store.path("deliveries/../../x")).toThrow()
  })

  it("downloads as an attachment under the given name", async () => {
    const url = await store.downloadUrl("deliveries/j1/1/a.csv", { filename: "listings.csv", ttlSec: 300, origin })
    expect(readGrant("s", "deliveries/j1/1/a.csv", params(url), T)).toMatchObject({ op: "get", name: "listings.csv" })
  })
})
