// What reaches the log about an unexpected error: never a failed query's parameters (a delivery's text, a note).
import { describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { createDb } from "@samite/db"
import { describeError } from "../../lib/server/errors"

describe("describeError", () => {
  it("keeps a failed query's name and code, never its parameters or the database's message", async () => {
    const db = await createDb("memory://")
    const secret = "the delivered text, private"
    const e = await db.execute(sql`select ${secret}::int`).then(
      () => null,
      (err: unknown) => err,
    )
    await db.$client.close?.()
    expect(e).toBeInstanceOf(Error)
    expect(String((e as Error).message) + String((e as Error).cause)).toContain(secret) // the raw error does carry it
    const logged = JSON.stringify(describeError(e))
    expect(logged).not.toContain(secret)
    expect(logged).toContain("database query failed")
  })

  it("keeps an ordinary error's message", () => {
    expect(describeError(new Error("RPC timed out"))).toEqual({ error: "RPC timed out", name: "Error" })
  })
})
