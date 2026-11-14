import { defineConfig } from "vitest/config"
// in-memory and on-disk Postgres (PGlite) is slow on a busy CI runner (5.4 s for one test, Nov 12)
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } })
