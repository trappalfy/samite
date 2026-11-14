import { afterAll, beforeAll, expect, it } from "vitest"
import { closeDb, createDb, type Db } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import { pgKv } from "../../lib/server/kv"

// The Postgres store on a real server (the local harness, pnpm --filter @samite/local run up): unlike PGlite, the
// pool runs statements at the same time, so this is where "exactly one wins" is really tested.
let db: Db
beforeAll(async () => {
  db = await createDb(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:55473/samite")
  await migrate(db)
})
afterAll(async () => closeDb(db))

it("concurrent requests on a pool: one setOnce wins, every incr gets its own count", async () => {
  const kv = pgKv(db)
  const k = `int:${Date.now()}:${Math.random()}`
  for (let round = 0; round < 5; round++) {
    const wins = await Promise.all(Array.from({ length: 25 }, () => kv.setOnce(`${k}:once:${round}`, 60)))
    expect(wins.filter(Boolean)).toHaveLength(1)
  }
  const counts = await Promise.all(Array.from({ length: 50 }, () => kv.incr(`${k}:count`, 60)))
  expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  const taken = await Promise.all(Array.from({ length: 10 }, () => kv.take(`${k}:once:0`)))
  expect(taken.filter((v) => v !== null)).toEqual(["1"])
})
