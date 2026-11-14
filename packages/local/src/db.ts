// A local Postgres for development (the web app and the worker share it; PGlite is single-process).
// The cluster lives in .data/local/pg (gitignored), on 127.0.0.1:55473, trust auth, so it never touches another server.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { localDir } from "./paths"

export const LOCAL_DB_PORT = 55473 // away from 5432/5433 and other projects' clusters
export const LOCAL_DATABASE_URL = `postgres://postgres@127.0.0.1:${LOCAL_DB_PORT}/samite`

const pgDir = (dir = localDir()) => join(dir, "pg")
function run(cmd: string, args: string[]) {
  try {
    // Postgres needs a valid locale at startup; the developer's shell may not have one
    return execFileSync(cmd, args, { stdio: "pipe", env: { ...process.env, LC_ALL: "C", LANG: "C" } }).toString()
  } catch (e) {
    const err = e as { stderr?: Buffer }
    throw new Error(`${cmd} failed: ${err.stderr?.toString().trim() ?? String(e)}`)
  }
}

export function dbIsUp(dir = localDir()): boolean {
  try {
    run("pg_ctl", ["-D", pgDir(dir), "status"])
    return true
  } catch {
    return false
  }
}

/** Creates the cluster on first use, starts it, and creates the `samite` database. Needs Postgres on PATH. */
export function startDb(dir = localDir()): string {
  const data = pgDir(dir)
  if (!existsSync(join(data, "PG_VERSION")))
    run("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--no-locale", "--no-instructions"])
  if (!dbIsUp(dir)) {
    const busy = (() => {
      try {
        return run("lsof", ["-nP", `-iTCP:${LOCAL_DB_PORT}`, "-sTCP:LISTEN", "-t"]).trim()
      } catch {
        return "" // lsof exits 1 when nothing listens
      }
    })()
    if (busy)
      throw new Error(
        `port ${LOCAL_DB_PORT} is taken by another process (pid ${busy}); not starting the local Postgres`,
      )
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      join(dir, "pg.log"),
      "-w",
      "-o",
      `-p ${LOCAL_DB_PORT} -k ${data} -h 127.0.0.1`,
      "start",
    ])
  }
  const exists = run("psql", [
    "-h",
    "127.0.0.1",
    "-p",
    String(LOCAL_DB_PORT),
    "-U",
    "postgres",
    "-tAc",
    "select 1 from pg_database where datname = 'samite'",
  ])
  if (exists.trim() !== "1")
    run("createdb", ["-h", "127.0.0.1", "-p", String(LOCAL_DB_PORT), "-U", "postgres", "samite"])
  return LOCAL_DATABASE_URL
}

export function stopDb(dir = localDir()) {
  if (dbIsUp(dir)) run("pg_ctl", ["-D", pgDir(dir), "-m", "fast", "-w", "stop"])
}

/** Drops and re-creates the `samite` database (the validator restarts from an empty ledger, so the index must too). */
export function resetDb(dir = localDir()) {
  startDb(dir)
  const args = ["-h", "127.0.0.1", "-p", String(LOCAL_DB_PORT), "-U", "postgres"]
  run("dropdb", [...args, "--if-exists", "--force", "samite"])
  run("createdb", [...args, "samite"])
  return LOCAL_DATABASE_URL
}
