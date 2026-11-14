// A tiny key-value store for replay protection, nonces and rate limits, shared by every server instance: the
// Postgres the app already uses (table `kv`; the owner's choice, Nov 14: one service fewer than Redis), or Upstash
// Redis when its two variables are set (§7.1). Memory only in unit tests: it is per process.
import { Redis } from "@upstash/redis"
import { and, eq, gt, lte, sql } from "drizzle-orm"
import { schema, type Db } from "@samite/db"

export interface Kv {
  /** Stores `key` for `ttlSec` if absent. True the first time; false if it was already there. */
  setOnce(key: string, ttlSec: number, value?: string): Promise<boolean>
  /** Removes `key` and returns its value; null if it wasn't there (or expired). */
  take(key: string): Promise<string | null>
  /** Increments a counter that expires `ttlSec` after its first increment; returns the new count. */
  incr(key: string, ttlSec: number): Promise<number>
}

export function memoryKv(now: () => number = Date.now): Kv {
  const m = new Map<string, { v: string; exp: number }>()
  const live = (k: string) => {
    const e = m.get(k)
    if (e && e.exp <= now()) m.delete(k)
    return m.get(k)
  }
  return {
    async setOnce(key, ttlSec, value = "1") {
      if (live(key)) return false
      m.set(key, { v: value, exp: now() + ttlSec * 1000 })
      return true
    },
    async take(key) {
      const e = live(key)
      m.delete(key)
      return e?.v ?? null
    },
    async incr(key, ttlSec) {
      const e = live(key)
      const n = (e ? Number(e.v) : 0) + 1
      m.set(key, { v: String(n), exp: e?.exp ?? now() + ttlSec * 1000 })
      return n
    },
  }
}

export function upstashKv(o: { url: string; token: string }): Kv {
  const r = new Redis({ url: o.url, token: o.token })
  return {
    setOnce: async (key, ttlSec, value = "1") => (await r.set(key, value, { nx: true, ex: ttlSec })) === "OK",
    take: async (key) => {
      const v = await r.getdel<string>(key)
      return v === null || v === undefined ? null : String(v)
    },
    incr: async (key, ttlSec) => {
      const n = await r.incr(key)
      if (n === 1) await r.expire(key, ttlSec)
      return n
    },
  }
}

/**
 * The same three operations on Postgres, each one statement, so concurrent requests on different instances can't
 * both win a `setOnce` or read the same count. Expired rows count as absent until the worker deletes them.
 */
export function pgKv(db: Db, now: () => number = Date.now): Kv {
  const { kv } = schema
  return {
    async setOnce(key, ttlSec, value = "1") {
      const t = new Date(now())
      const expiresAt = new Date(t.getTime() + ttlSec * 1000)
      // insert, or take over a row that has expired; a live row stays and nothing is returned
      const rows = await db
        .insert(kv)
        .values({ key, value, expiresAt })
        .onConflictDoUpdate({ target: kv.key, set: { value, expiresAt }, setWhere: lte(kv.expiresAt, t) })
        .returning({ key: kv.key })
      return rows.length === 1
    },
    async take(key) {
      const rows = await db
        .delete(kv)
        .where(and(eq(kv.key, key), gt(kv.expiresAt, new Date(now()))))
        .returning({ value: kv.value })
      return rows[0]?.value ?? null
    },
    async incr(key, ttlSec) {
      const t = new Date(now())
      const expiresAt = new Date(t.getTime() + ttlSec * 1000)
      const expired = sql`${kv.expiresAt} <= ${t.toISOString()}::timestamptz`
      const rows = await db
        .insert(kv)
        .values({ key, value: "1", expiresAt })
        .onConflictDoUpdate({
          target: kv.key,
          set: {
            value: sql`case when ${expired} then '1' else (${kv.value}::bigint + 1)::text end`,
            expiresAt: sql`case when ${expired} then ${expiresAt.toISOString()}::timestamptz else ${kv.expiresAt} end`,
          },
        })
        .returning({ value: kv.value })
      return Number(rows[0]!.value)
    },
  }
}
