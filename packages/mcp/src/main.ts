#!/usr/bin/env node
// @samite/mcp over stdio. Configure it in an MCP client (§6.3):
//   { "mcpServers": { "samite": { "command": "npx", "args": ["-y", "@samite/mcp"],
//     "env": { "SAMITE_KEYPAIR": "~/.config/samite/machine.json" } } } }
// stdout is the protocol channel: everything else goes to stderr.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit"
import { parseUsdc } from "@samite/config/money"
import { createSamite } from "@samite/sdk"
import { spendGuard } from "./guards"
import { buildServer } from "./server"

const env = process.env
const home = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p)
const keyFile = env.SAMITE_KEYPAIR
if (!keyFile) {
  console.error("SAMITE_KEYPAIR is not set: the path of this machine's keypair file (a JSON array of 64 bytes).")
  process.exit(1)
}
const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(home(keyFile), "utf8"))))
const api = (env.SAMITE_API ?? "https://samite.fun").replace(/\/$/, "")
const rpcUrl = env.SAMITE_RPC_URL ?? "https://api.mainnet-beta.solana.com"
const usdcEnv = (name: string) => parseUsdc(env[name] ?? "0") ?? 0n
// before launch samite.fun answers only the team (SAMITE_ACCESS_KEY, sent to the site only)
const samite = createSamite({
  api,
  rpc: createSolanaRpc(rpcUrl),
  signer,
  accessKey: env.SAMITE_ACCESS_KEY || undefined,
})
const guard = spendGuard({
  maxPost: usdcEnv("SAMITE_MAX_POST_USDC"),
  dailySpend: usdcEnv("SAMITE_DAILY_SPEND_USDC"),
  dir: home(env.SAMITE_STATE_DIR ?? "~/.config/samite"),
  address: signer.address,
})

const handle = serveStdio(() =>
  buildServer({ samite, guard, confirmMode: env.SAMITE_CONFIRM === "1", api, keyFile: home(keyFile) }),
)
console.error(`samite mcp: machine ${signer.address} on ${api}; posting ${guard.enabled ? "on" : "off"}`)
process.on("SIGINT", () => void handle.close())
