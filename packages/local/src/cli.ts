// pnpm --filter @samite/local run up [--no-config] | down
import { bootstrap } from "./bootstrap"
import { createDb } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import { resetDb, stopDb } from "./db"
import { localClient } from "./tx"
import { LOCAL_RPC, startValidator, stopValidator } from "./validator"

const cmd = process.argv[2]
if (cmd === "up") {
  await startValidator()
  // --no-config: leave initialize_config to scripts/mainnet/initialize-config.ts --rehearse-local
  const s = await bootstrap(localClient(), { initConfig: !process.argv.includes("--no-config") })
  // a fresh ledger means a fresh index, migrated so the web app can start before the worker
  const db = resetDb()
  const index = await createDb(db)
  await migrate(index)
  await index.$client.end?.()
  console.log(`local validator at ${LOCAL_RPC}`)
  console.log(`local postgres at ${db}`)
  for (const [role, k] of Object.entries(s)) console.log(`  ${role.padEnd(10)} ${k.address}`)
} else if (cmd === "down") {
  stopValidator()
  stopDb()
  console.log("stopped")
} else {
  console.log("usage: up | down")
  process.exitCode = 1
}
