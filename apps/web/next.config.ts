import type { NextConfig } from "next"
import createMDX from "@next/mdx"

const config: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ["ts", "tsx", "mdx"],
  poweredByHeader: false,
  transpilePackages: ["@samite/ui", "@samite/config"],
  async headers() {
    // hardening on every route; the Content-Security-Policy needs a nonce per request, so proxy.ts sets it (lib/csp.ts)
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ]
  },
  async redirects() {
    // www → apex is also set in Vercel's domain settings; this keeps it true on any host
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.samite.fun" }],
        destination: "https://samite.fun/:path*",
        permanent: true,
      },
    ]
  },
}

export default createMDX({ options: { remarkPlugins: ["remark-gfm"] } })(config)
