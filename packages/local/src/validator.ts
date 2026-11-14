// solana-test-validator with the escrow program (upgradeable, local authority) and local USDC at the real address.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createSolanaRpc } from "@solana/kit"
import { SAMITE_ESCROW_PROGRAM_ADDRESS } from "@samite/program-client"
import { ensureKeys, keyPath, loadSigner } from "./keys"
import { usdcMintAccount } from "./mint"
import { localDir, programSo, repoRoot } from "./paths"

export const LOCAL_RPC = "http://127.0.0.1:8899"
export const LOCAL_WS = "ws://127.0.0.1:8900"

export async function isUp(url = LOCAL_RPC) {
  try {
    return (await createSolanaRpc(url).getHealth().send()) === "ok"
  } catch {
    return false
  }
}

/** Starts the local validator unless one is already up. True if this call started it (so the caller may stop it). */
export async function startValidator({ reset = true } = {}): Promise<boolean> {
  if (await isUp()) return false
  const root = repoRoot(),
    dir = localDir(root)
  if (!existsSync(programSo(root))) throw new Error("build the program first: anchor build")
  ensureKeys(dir)
  mkdirSync(dir, { recursive: true })
  const authority = await loadSigner("authority", dir)
  const mintFile = join(dir, "usdc-mint.json")
  writeFileSync(mintFile, JSON.stringify(usdcMintAccount(authority.address)))
  const log = openSync(join(dir, "validator.log"), "w")
  const args = [
    ...(reset ? ["--reset"] : []),
    "--quiet",
    // keep hours of history (the default keeps minutes), so a restarted indexer can still read its cursor
    "--limit-ledger-size",
    "50000000",
    "--ledger",
    join(dir, "ledger"),
    "--rpc-port",
    "8899",
    "--upgradeable-program",
    SAMITE_ESCROW_PROGRAM_ADDRESS,
    programSo(root),
    keyPath("authority", dir),
    "--account",
    "-",
    mintFile,
  ]
  const child = spawn("solana-test-validator", args, { detached: true, stdio: ["ignore", log, log], cwd: dir })
  child.unref()
  writeFileSync(join(dir, "validator.pid"), String(child.pid))
  for (let i = 0; i < 120; i++) {
    if (await isUp()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`the validator did not come up; see ${join(dir, "validator.log")}`)
}

export function stopValidator() {
  const pidFile = join(localDir(), "validator.pid")
  if (!existsSync(pidFile)) return
  try {
    process.kill(Number(readFileSync(pidFile, "utf8")))
  } catch {
    /* already gone */
  }
  rmSync(pidFile)
}
