import { defineConfig, devices } from "@playwright/test"

// The M3 acceptance run (`pnpm --filter web e2e:m3`): the local harness must be up (pnpm --filter @samite/local run up);
// the spec starts the worker; this starts the web app against the harness's Postgres and validator.
const PORT = 3200
export const BASE = `http://localhost:${PORT}`
export const LOCAL_DB = "postgres://postgres@127.0.0.1:55473/samite"

export default defineConfig({
  testDir: "e2e",
  testMatch: ["**/*.acceptance.spec.ts"],
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE, ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  webServer: {
    command: `next start -p ${PORT}`,
    env: { DATABASE_URL: LOCAL_DB, SOLANA_RPC_URL: "http://127.0.0.1:8899" },
    url: `${BASE}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
