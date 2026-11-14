import { defineConfig, devices } from "@playwright/test"

// The Privy check by hand (e2e/privy.manual.spec.ts): the app built with NEXT_PUBLIC_PRIVY_APP_ID must already be
// serving on localhost:3000 (an origin allowed in the Privy dashboard), with the local harness and a worker.
export default defineConfig({
  testDir: "e2e",
  testMatch: ["**/privy.manual.spec.ts"],
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
})
