// Who may read a job's deliveries (CLAUDE.md §5.2): the poster sees every delivery; a machine sees only the ones it
// submitted, even after it left the job; nobody else sees any. A machine that claims a job after another machine was
// rejected and left must not get the earlier machine's work.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { address, type Address } from "@solana/kit"
import { createDb, schema, type Db } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import type { Server } from "../../lib/server/context"
import { ApiError } from "../../lib/server/errors"
import { readDelivery } from "../../lib/server/work"

// real, valid addresses with no meaning here
const POSTER = address("8qQ1BybTXdJSHqW6s6RZwR982oAGbqKmEmgpVWKVng3c")
const FIRST = address("9B6oPeqPKzRQXK2W2fJEUgRDxFC4PYrRthseKW8BeJde") // delivered, was rejected, left
const NOW = address("8ep1fsm4r1T2cFxdy2oS4tDbn1teZbtHoKEYYUjpSvf4") // claimed after, delivered too
const STRANGER = address("Du6zV7kbUmAmvNShgnvvZqRDZ85uoXVQKNknvxxRMUnL")
const PDA = "E5CMmNDiAoXPRhL1WgBjXpHjXuDMKFoVCoDJPF7t6uUi"

let db: Db
const s = () =>
  ({
    db,
    store: { downloadUrl: async (key: string) => `https://files.test/${key}` },
  }) as unknown as Server

beforeAll(async () => {
  db = await createDb("memory://")
  await migrate(db)
  await db.insert(schema.jobs).values({
    displayNo: 7,
    pda: PDA,
    poster: POSTER,
    postedFrom: "app",
    jobId: "1",
    specHash: "00".repeat(32),
    reward: 5_000_000n,
    feeBps: 250,
    status: "delivered",
    worker: NOW,
    policy: { kind: "any" } as never,
    deadline: 2_000_000_000n,
    reviewWindow: 172_800,
    claimWindow: 0,
    deliveries: 1,
    deliveryHash: "bb".repeat(32),
    createdAt: 1_700_000_000n,
    postedSlot: 1n,
    updatedSlot: 2n,
  })
  const file = (name: string) => ({
    v: "samite/delivery@1",
    job: PDA,
    kind: "file",
    files: [{ name, bytes: 1, sha256: "00".repeat(32) }],
  })
  await db.insert(schema.deliveries).values([
    {
      jobPda: PDA,
      jobNo: 7,
      attempt: 1,
      worker: FIRST,
      manifest: file("first.csv"),
      deliveryHash: "aa".repeat(32),
      storageKeys: ["k/first"],
      submittedSig: "sig1",
    },
    {
      jobPda: PDA,
      jobNo: 7,
      attempt: 1,
      worker: NOW,
      manifest: file("now.csv"),
      deliveryHash: "bb".repeat(32),
      storageKeys: ["k/now"],
      submittedSig: "sig2",
    },
  ])
})
afterAll(async () => db.$client.close?.())

const names = async (who: Address) =>
  (await readDelivery(s(), who, "0007", "https://samite.test")).deliveries.flatMap((d) => d.files.map((f) => f.name))

describe("reading deliveries", () => {
  it("shows the poster every delivery", async () => {
    expect((await names(POSTER)).sort()).toEqual(["first.csv", "now.csv"])
  })

  it("shows the machine on the job only its own delivery, not the earlier machine's", async () => {
    expect(await names(NOW)).toEqual(["now.csv"])
  })

  it("still shows a machine that left the job its own delivery", async () => {
    expect(await names(FIRST)).toEqual(["first.csv"])
  })

  it("gives no links once the files are deleted, and says so", async () => {
    await db.update(schema.deliveries).set({ storageKeys: [] }).where(eq(schema.deliveries.worker, FIRST))
    const r = await readDelivery(s(), FIRST, "0007", "https://samite.test")
    expect(r.deliveries).toMatchObject([{ files_deleted: true, files: [{ name: "first.csv", url: null }] }])
  })

  it("once deleted after 90 days, gives the record and the hash and nothing else", async () => {
    await db
      .update(schema.deliveries)
      .set({
        storageKeys: [],
        manifest: { v: "samite/delivery@1", job: "pda", attempt: 1, kind: "file", deleted: true },
        prunedAt: new Date(),
      })
      .where(eq(schema.deliveries.worker, FIRST))
    const r = await readDelivery(s(), FIRST, "0007", "https://samite.test")
    expect(r.deliveries).toHaveLength(1)
    expect(r.deliveries[0]).toMatchObject({ deleted: true, files_deleted: true, files: [] })
    expect(JSON.stringify(r.deliveries[0])).not.toContain("first.csv")
  })

  it("refuses anyone else", async () => {
    await expect(names(STRANGER)).rejects.toMatchObject({ code: "forbidden" } satisfies Partial<ApiError>)
  })
})
