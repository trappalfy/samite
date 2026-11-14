import type { Metadata } from "next"
import { isExample, type Search } from "@/lib/data"
import { PostForm } from "./PostForm"

export const metadata: Metadata = { title: "Post a job" }

export default async function PostPage({ searchParams }: { searchParams: Search }) {
  return (
    <main>
      <PostForm example={await isExample(searchParams)} />
    </main>
  )
}
