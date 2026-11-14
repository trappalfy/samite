import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDb, schema, type Db } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import { memoryKv, pgKv, type Kv } from "../../lib/server/kv"

// One contract for every store the server can use (lib/server/kv.ts): what replay protection, sign-in nonces and
// rate limits rely on. Postgres runs on PGlite here and on the local harness's Postgres in the M3 acceptance run.
let db: Db
beforeAll(async () => {
  db = await createDb("memory://")
  await migrate(db)
})
afterAll(async () => db.$client.close?.())

const stores: [string, (now: () => number) => Kv][] = [
  ["memory", (now) => memoryKv(now)],
  ["postgres", (now) => pgKv(db, now)],
]

let n = 0
const fresh = () => `k${++n}:${Math.random()}`

for (const [name, make] of stores)
  describe(`${name} store`, () => {
    let t = 1_800_000_000_000
    const now = () => t
    let kv: Kv
    beforeAll(() => {
      kv = make(now) // after the database is up
    })

    it("setOnce: true the first time, false while the key lives, true again once it has expired", async () => {
      const k = fresh()
      expect(await kv.setOnce(k, 120)).toBe(true)
      expect(await kv.setOnce(k, 120)).toBe(false)
      t += 119_000
      expect(await kv.setOnce(k, 120)).toBe(false)
      t += 2_000
      expect(await kv.setOnce(k, 120)).toBe(true)
    })

    it("take: returns the value once, then null; null for a key that has expired", async () => {
      const k = fresh()
      await kv.setOnce(k, 60, "v1")
      expect(await kv.take(k)).toBe("v1")
      expect(await kv.take(k)).toBeNull()
      const e = fresh()
      await kv.setOnce(e, 60, "v2")
      t += 61_000
      expect(await kv.take(e)).toBeNull()
    })

    it("incr: counts within the window, starts again at 1 after it", async () => {
      const k = fresh()
      expect(await kv.incr(k, 60)).toBe(1)
      expect(await kv.incr(k, 60)).toBe(2)
      t += 30_000
      expect(await kv.incr(k, 60)).toBe(3) // the window runs from the first increment, not the last
      t += 31_000
      expect(await kv.incr(k, 60)).toBe(1)
    })

    it("concurrent callers: exactly one setOnce wins, and every incr gets its own count", async () => {
      const k = fresh()
      const wins = await Promise.all(Array.from({ length: 20 }, () => kv.setOnce(k, 60)))
      expect(wins.filter(Boolean)).toHaveLength(1)
      const c = fresh()
      const counts = await Promise.all(Array.from({ length: 20 }, () => kv.incr(c, 60)))
      expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    })
  })

it("postgres: an expired row is only absent, and the worker's delete removes it", async () => {
  const t = 1_900_000_000_000
  const kv = pgKv(db, () => t)
  const k = fresh()
  await kv.setOnce(k, 1)
  const { lte } = await import("drizzle-orm")
  await db.delete(schema.kv).where(lte(schema.kv.expiresAt, new Date(t + 2_000)))
  const left = await db.select().from(schema.kv)
  expect(left.find((r) => r.key === k)).toBeUndefined()
})
