import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
export const resolve = { alias: { "@/": here("./"), "server-only": here("./test/stubs/server-only.ts") } }

// unit tests; *.int.test.ts need the local harness (pnpm --filter @samite/local run up)
export default defineConfig({
  resolve,
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.int.test.ts"],
    // in-memory Postgres (PGlite) boots in 4–5.5 s on a CI runner: context.test.ts timed out at the 5 s default on main
    // twice (Nov 14). The worker and db packages use the same limits for the same reason.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
