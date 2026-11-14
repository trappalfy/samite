import { defineConfig } from "vitest/config"
import { resolve } from "./vitest.config"

export default defineConfig({ resolve, test: { include: ["test/**/*.int.test.ts"], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false } })
