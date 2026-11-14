// A delivery's content is deleted once its job has been closed for the retention period (§5.2, the privacy page):
// the files, and the text, link, note and file names in the manifest (Nov 13). The hash and the bare record stay.
// Deliveries of open jobs, or of jobs closed more recently, are kept whole.
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { createDb, schema, type Db } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import { fsStore } from "@samite/storage"
import { purgeDeliveries } from "../src/purge"

const dir = mkdtempSync(join(tmpdir(), "samite-purge-"))
const store = fsStore({ dir, secret: "s" })
const NOW = new Date("2026-11-12T12:00:00Z")
const day = 24 * 3600 * 1000
let db: Db

const manifest = (jobNo: number) => ({
  v: "samite/delivery@1",
  job: `pda-${jobNo}`,
  attempt: 1,
  kind: "file",
  files: [{ name: "clients.csv", bytes: 3, sha256: "ab".repeat(32) }],
  note: "Rows 4 and 9 have private phone numbers.",
})
const row = (jobNo: number, key: string, purgeAfter: Date | null) => ({
  jobPda: `pda-${jobNo}`,
  jobNo,
  attempt: 1,
  worker: "machine",
  manifest: manifest(jobNo),
  deliveryHash: `${jobNo}`.padStart(64, "0"),
  storageKeys: [key],
  submittedSig: "sig",
  purgeAfter,
})

beforeAll(async () => {
  db = await createDb("memory://")
  await migrate(db)
  for (const k of ["d/due/a.csv", "d/later/b.csv", "d/open/c.csv"])
    await store.put(k, new Uint8Array([1, 2, 3]), "text/csv")
  await db.insert(schema.deliveries).values([
    row(1, "d/due/a.csv", new Date(NOW.getTime() - day)), // closed more than 90 days ago
    row(2, "d/later/b.csv", new Date(NOW.getTime() + day)), // closed less than 90 days ago
    row(3, "d/open/c.csv", null), // job still open
    // a text delivery past its time: no files, but its text and note must go too
    {
      ...row(4, "", new Date(NOW.getTime() - day)),
      storageKeys: [],
      manifest: { v: "samite/delivery@1", job: "pda-4", attempt: 1, kind: "text", text: "the answer", note: "n" },
    },
  ])
})
afterAll(async () => {
  await db.$client.close?.()
  rmSync(dir, { recursive: true, force: true })
})

describe("deleting deliveries after their time", () => {
  it("deletes the files, and the text, note and file names, of the deliveries whose time has come", async () => {
    const logs: Record<string, unknown>[] = []
    expect(await purgeDeliveries(db, store, { now: NOW, log: (l) => logs.push(l) })).toBe(2)
    expect(existsSync(join(dir, "d/due/a.csv"))).toBe(false)
    expect(existsSync(join(dir, "d/later/b.csv"))).toBe(true)
    expect(existsSync(join(dir, "d/open/c.csv"))).toBe(true)
    const byNo = async (n: number) =>
      (await db.select().from(schema.deliveries).where(eq(schema.deliveries.jobNo, n)))[0]!
    const bare = (n: number, kind: string) => ({
      v: "samite/delivery@1",
      job: `pda-${n}`,
      attempt: 1,
      kind,
      deleted: true,
    })
    expect(await byNo(1)).toMatchObject({
      storageKeys: [],
      manifest: bare(1, "file"),
      deliveryHash: "1".padStart(64, "0"),
      prunedAt: NOW,
    })
    expect((await byNo(4)).manifest).toEqual(bare(4, "text"))
    // not yet: whole
    expect(await byNo(2)).toMatchObject({ storageKeys: ["d/later/b.csv"], manifest: manifest(2), prunedAt: null })
    expect(await byNo(3)).toMatchObject({ storageKeys: ["d/open/c.csv"], manifest: manifest(3), prunedAt: null })
    // the log says how many files, never which, nor any content
    expect(logs).toEqual([
      { msg: "delivery deleted", job: 1, files: 1 },
      { msg: "delivery deleted", job: 4, files: 0 },
    ])
  })

  it("does nothing the second time", async () => {
    expect(await purgeDeliveries(db, store, { now: NOW })).toBe(0)
  })
})
