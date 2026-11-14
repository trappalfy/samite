import { PGlite } from "@electric-sql/pglite"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle as drizzlePglite } from "drizzle-orm/pglite"
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator"
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js"
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import * as schema from "./schema"
import { forPostgresJs } from "./url"

export * as schema from "./schema"
export { forPostgresJs } from "./url"
export type Schema = typeof schema

/** One Drizzle database over either driver. `$client.close` (PGlite) or `$client.end` (postgres-js) shuts it. */
export type Db = PgDatabase<PgQueryResultHKT, Schema> & {
  $client: { close?: () => Promise<void>; end?: () => Promise<void> }
  $kind: "pglite" | "postgres"
}

/**
 * `postgres://…` / `postgresql://…` → postgres-js (production, Neon), with TLS verified (`forPostgresJs`).
 * `memory://`, `pglite://<dir>` or a plain path → PGlite (tests and the local harness).
 */
export async function createDb(url: string): Promise<Db> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const client = postgres(forPostgresJs(url), { max: 5 })
    return Object.assign(drizzlePostgres({ client, schema }), { $kind: "postgres" as const }) as unknown as Db
  }
  const dir = url.startsWith("pglite://") ? url.slice("pglite://".length) : url
  const client = new PGlite(dir === "memory://" ? undefined : dir)
  await client.waitReady
  return Object.assign(drizzlePglite({ client, schema }), { $kind: "pglite" as const }) as unknown as Db
}

/**
 * Applies the migrations in `migrationsFolder`. Use `migrate` from "@samite/db/migrate", which knows where the
 * committed ones are; this entry point never touches the filesystem, so bundlers (the web app) can import it.
 */
export async function migrateDb(db: Db, migrationsFolder: string) {
  const config = { migrationsFolder }
  if (db.$kind === "pglite") await migratePglite(db as unknown as Parameters<typeof migratePglite>[0], config)
  else await migratePostgres(db as unknown as Parameters<typeof migratePostgres>[0], config)
}

export async function closeDb(db: Db) {
  await (db.$client.close?.() ?? db.$client.end?.())
}
