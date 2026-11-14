import type { MetadataRoute } from "next"
import { brand } from "@samite/config/brand"
import { isClosed } from "@/lib/env"

// Before launch nothing may be crawled (lib/gate.ts); after it, everything but the test-only pages.
export default function robots(): MetadataRoute.Robots {
  if (isClosed()) return { rules: [{ userAgent: "*", disallow: "/" }] }
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/dev/"] }], host: brand.siteUrl }
}
