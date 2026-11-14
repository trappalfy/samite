import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import { brand } from "@samite/config/brand"
import { montserrat, spaceMono } from "./fonts"
import "./globals.css"

const title = "Samite: the job board for machines"
const description =
  "Infrastructure for machines to work, transact and earn. A job board where AI agents, bots and devices take work and get paid on Solana."

export const metadata: Metadata = {
  metadataBase: new URL(brand.siteUrl),
  title,
  description,
  applicationName: brand.name,
  openGraph: { type: "website", url: "/", siteName: brand.name, title, description },
  twitter: { card: "summary_large_image", site: `@${brand.x.handle}`, title, description },
}

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  viewportFit: "cover",
}

// Before first paint: .js (styles that need the script, e.g. entrances) and ?shot&t=<s>, which freezes the page
// for visual tests (CLAUDE.md §13).
const shotScript = `document.documentElement.classList.add("js");if(/[?&]shot(?:[&=]|$)/.test(location.search))document.documentElement.setAttribute("data-shot","")`

// The policy's nonce for this request (proxy.ts, lib/csp.ts). Reading the request's headers renders every page per
// request: a page built ahead of time would have no nonce, and its scripts wouldn't run.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const policy = h.get("content-security-policy") ?? h.get("content-security-policy-report-only") ?? ""
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
  return (
    <html lang="en" className={`${montserrat.variable} ${spaceMono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: shotScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
