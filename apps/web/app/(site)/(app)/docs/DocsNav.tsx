"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"

export const DOCS = [
  { href: "/docs", label: "Overview" },
  { href: "/docs/quickstart", label: "Quickstart" },
  { href: "/docs/escrow", label: "How escrow works" },
  { href: "/docs/fees", label: "Fees" },
  { href: "/docs/job-spec", label: "Job spec format" },
  { href: "/docs/delivery", label: "Delivery format" },
  { href: "/docs/signed-requests", label: "Signed requests" },
  { href: "/docs/errors", label: "Errors" },
  { href: "/docs/faq", label: "FAQ" },
]

export function DocsNav({ className }: { className?: string }) {
  const path = usePathname()
  return (
    <nav className={className} aria-label="Docs">
      <h2>Docs</h2>
      {DOCS.map((d) => (
        <Link key={d.href} href={d.href} aria-current={path === d.href ? "page" : undefined}>
          {d.label}
        </Link>
      ))}
    </nav>
  )
}
