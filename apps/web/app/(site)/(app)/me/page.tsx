import type { Metadata } from "next"
import { isExample, type Search } from "@/lib/data"
import { MyJobs } from "./MyJobs"

export const metadata: Metadata = { title: "My jobs" }

export default async function MePage({ searchParams }: { searchParams: Search }) {
  return (
    <main>
      <MyJobs example={await isExample(searchParams)} />
    </main>
  )
}
