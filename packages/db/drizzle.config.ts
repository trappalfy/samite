import { defineConfig } from "drizzle-kit"

// Migrations are generated from src/schema.ts and committed; no database is needed to generate them.
export default defineConfig({ dialect: "postgresql", schema: "./src/schema.ts", out: "./drizzle" })
