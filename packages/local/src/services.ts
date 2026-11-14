// The worker and the web app against the local harness, for integration tests that need the real HTTP API
// (`pnpm --filter web build` first). Each call starts its own pair on the given ports and stops them after.
import { spawn, type ChildProcess } from "node:child_process"
import { openSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getBase58Decoder } from "@solana/kit"
import { LOCAL_DATABASE_URL } from "./db"
import { keyPath } from "./keys"
import { localDir, repoRoot } from "./paths"
import { LOCAL_RPC } from "./validator"

async function healthy(url: string, ms = 60_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if ((await fetch(url).catch(() => null))?.ok) return
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`${url} did not come up`)
}

export async function startServices(o: { webPort?: number; workerPort?: number } = {}) {
  const root = repoRoot()
  const webPort = o.webPort ?? 3300
  const workerPort = o.workerPort ?? 8792
  const env = { ...process.env, DATABASE_URL: LOCAL_DATABASE_URL, SOLANA_RPC_URL: LOCAL_RPC }
  const keeper = getBase58Decoder().decode(Uint8Array.from(JSON.parse(readFileSync(keyPath("keeper"), "utf8"))))
  // the binaries themselves, each leading its own process group, so stop() takes down every child (a `pnpm exec`
  // wrapper would leave the real server running); output goes to .data/local/<name>-<port>.log
  const run = (name: string, cwd: string, bin: string, args: string[], extra: Record<string, string>) =>
    spawn(join(cwd, "node_modules/.bin", bin), args, {
      cwd,
      env: { ...env, ...extra },
      detached: true,
      stdio: [
        "ignore",
        openSync(join(localDir(root), `${name}.log`), "w"),
        openSync(join(localDir(root), `${name}.log`), "a"),
      ],
    })
  const procs: ChildProcess[] = [
    run(`worker-${workerPort}`, join(root, "apps/worker"), "tsx", ["src/main.ts"], {
      PORT: String(workerPort),
      KEEPER_ENABLED: "true",
      KEEPER_SECRET: keeper,
    }),
    run(`web-${webPort}`, join(root, "apps/web"), "next", ["start", "-p", String(webPort)], {}),
  ]
  const stop = () =>
    procs.forEach((p) => {
      try {
        process.kill(-p.pid!, "SIGTERM")
      } catch {
        /* already gone */
      }
    })
  try {
    await healthy(`http://localhost:${workerPort}/health`)
    await healthy(`http://localhost:${webPort}/api/v1/health`)
  } catch (e) {
    stop()
    throw e
  }
  return { api: `http://localhost:${webPort}`, stop }
}
