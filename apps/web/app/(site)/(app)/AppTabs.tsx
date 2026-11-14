"use client"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { EXAMPLE_MACHINE } from "@/lib/examples"
import { useWallet } from "@/lib/wallet/store"

const TABS = [
  { href: "/jobs", label: "Board", match: (p: string) => p === "/jobs" },
  { href: "/jobs/new", label: "Post a job", match: (p: string) => p === "/jobs/new" },
  // a job page counts as "My jobs" (the example job is posted by you, as in the prototype)
  { href: "/me", label: "My jobs", match: (p: string) => p === "/me" || (p.startsWith("/jobs/") && p !== "/jobs/new") },
  { href: "/machines", label: "Machines", match: (p: string) => p.startsWith("/machines") },
  { href: "/docs", label: "Docs", match: (p: string) => p.startsWith("/docs") },
]

/** The app's top-bar tabs; on phones they become a horizontally scrolling second row (CSS). */
export function AppTabs({ className }: { className?: string }) {
  const path = usePathname()
  const example = useSearchParams().has("example")
  const { connected } = useWallet()
  const href = (t: (typeof TABS)[number]) => {
    if (t.label === "Machines")
      return example
        ? `/machines/${EXAMPLE_MACHINE.address}?example`
        : connected
          ? `/machines/${connected.address}`
          : "/machines"
    return example && t.label !== "Docs" ? `${t.href}?example` : t.href
  }
  return (
    <nav className={className} aria-label="App">
      {TABS.map((t) => (
        <Link key={t.label} href={href(t)} aria-current={t.match(path) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
