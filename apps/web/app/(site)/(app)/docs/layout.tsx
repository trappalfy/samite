import { DocsNav } from "./DocsNav"
import s from "./docs.module.css"

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.docs}>
      <DocsNav className={s.nav} />
      <main className={s.prose}>
        {/* on every docs page until M6: none of this is live yet, and a shared link must say so */}
        <blockquote>
          <p>
            <strong>Draft.</strong> The escrow program, the API, the SDK and the MCP server are being built. These pages
            describe v1 as it will ship. Nothing here is live yet.
          </p>
        </blockquote>
        {children}
      </main>
    </div>
  )
}
