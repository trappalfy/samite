import type { Metadata } from "next"
import { isIndexable } from "@/lib/env"
import Link from "next/link"
import { Suspense } from "react"
import { BracketButton } from "@samite/ui/components"
import { appClass as s } from "@samite/ui/app"
import { AppTabs } from "./AppTabs"
import { WalletChip } from "./WalletChip"
import { WalletLayer } from "./WalletLayer"

export const metadata: Metadata = {
  title: { default: "Samite app", template: "%s · Samite" },
  // closed and unindexed until launch (lib/gate.ts); read at build time, and Vercel rebuilds on an env change
  robots: { index: isIndexable(), follow: isIndexable() },
}

// The app shell (§11.12): a 64 px sticky top bar (brand · tabs · actions). Calmer than the site: no grain.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.app}>
      <header className={s.top}>
        <div>
          <Link className={s.brand} href="/">
            {/* eslint-disable-next-line @next/next/no-img-element -- the owner's SVG mark, as is */}
            <img src="/brand/samite-mark-cream.svg" alt="" width={25} height={20} />
            <b>SAMITE</b>
            <span>APP</span>
          </Link>
        </div>
        <Suspense fallback={<nav className={s.tabs} aria-label="App" />}>
          <AppTabs className={s.tabs} />
        </Suspense>
        <div className={s.right}>
          <BracketButton tone="dark" size="sm" href="/jobs/new" className={s.hideS}>
            Post a job
          </BracketButton>
          {/* static pages (docs) render the chip after hydration; it reads ?example */}
          <Suspense fallback={<span className={s.wallet} aria-hidden="true" style={{ visibility: "hidden" }} />}>
            <WalletChip example={process.env.SAMITE_EXAMPLE_DATA === "1"} />
          </Suspense>
        </div>
      </header>
      {children}
      <WalletLayer />
    </div>
  )
}
