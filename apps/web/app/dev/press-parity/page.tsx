import { notFound } from "next/navigation"
import { connection } from "next/server"
import { Harness } from "./Harness"

// Test-only: exposes the TS press to Playwright so it can be compared with the reference engine.
// 404 unless the server runs with SAMITE_HARNESS=1 (never set on Vercel).
export default async function PressParityPage() {
  await connection()
  if (process.env.SAMITE_HARNESS !== "1") notFound()
  return <Harness />
}
