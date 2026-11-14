import { describe, expect, it } from "vitest"
import { forPostgresJs } from "../src/url"

// shaped like Neon's console output; not a real host or password
const neon = "postgresql://samite_owner:p%40ss-w0rd@ep-example-123456-pooler.us-east-1.aws.neon.tech/neondb"

describe("forPostgresJs", () => {
  it("turns sslmode=require into verify-full and drops channel_binding (Neon's default string)", () => {
    expect(forPostgresJs(`${neon}?sslmode=require&channel_binding=require`)).toBe(`${neon}?sslmode=verify-full`)
  })

  it("keeps the user, the percent-encoded password, the host and the database byte for byte", () => {
    expect(forPostgresJs(`${neon}?channel_binding=require&sslmode=require`).split("?")[0]).toBe(neon)
  })

  it("leaves other parameters and modes alone", () => {
    expect(forPostgresJs(`${neon}?sslmode=verify-full&application_name=worker`)).toBe(
      `${neon}?sslmode=verify-full&application_name=worker`,
    )
    expect(forPostgresJs(`${neon}?sslmode=disable`)).toBe(`${neon}?sslmode=disable`)
  })

  it("leaves strings without parameters alone (the local harness)", () => {
    expect(forPostgresJs("postgres://postgres@127.0.0.1:55473/samite")).toBe(
      "postgres://postgres@127.0.0.1:55473/samite",
    )
  })

  it("drops a lone channel_binding without leaving a dangling ?", () => {
    expect(forPostgresJs(`${neon}?channel_binding=prefer`)).toBe(neon)
  })
})
