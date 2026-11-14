import { defineConfig } from "vitest/config"
// unit tests; *.svm.test.ts need the built program (CI's program job), *.int.test.ts a running local validator
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.int.test.ts", "test/**/*.svm.test.ts"],
    // in-memory Postgres (PGlite) is slow on a busy CI runner: one indexer test took 5.8 s there (Nov 12)
    testTimeout: 30_000,
    // the same for hooks: a beforeAll that builds a fresh PGlite and syncs the session timed out at the 10 s default (Nov 14)
    hookTimeout: 30_000,
  },
})
