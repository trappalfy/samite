"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { BoxButton } from "@samite/ui/components"

/** The 46 px menu box: opens the site links (the nav hides them under 1100 px). Esc and outside clicks close it. */
export function Menu({ className, links }: { className?: string; links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    const click = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && setOpen(false)
    document.addEventListener("keydown", key)
    document.addEventListener("click", click)
    return () => {
      document.removeEventListener("keydown", key)
      document.removeEventListener("click", click)
    }
  }, [open])
  return (
    <>
      <BoxButton
        icon
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="square"
          aria-hidden="true"
        >
          <path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
        </svg>
      </BoxButton>
      {open && (
        <div className={className} id="site-menu" ref={ref}>
          {links.map((l) => (
            <Link key={l.label} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
