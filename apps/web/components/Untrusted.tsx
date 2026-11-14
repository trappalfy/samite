// Text written by posters and machines (specs, notes, reasons) is untrusted (§12): Markdown with HTML off, no images
// (nothing loads from a URL they chose), links marked nofollow noopener ugc and opened in a new tab.
import Markdown from "react-markdown"

const ALLOWED = [
  "p",
  "a",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "code",
  "pre",
  "blockquote",
  "br",
  "hr",
  "h3",
  "h4",
  "h5",
  "h6",
]

export function Untrusted({ children }: { children: string }) {
  return (
    <Markdown
      skipHtml
      allowedElements={ALLOWED}
      unwrapDisallowed
      components={{
        a: ({ href, children: c }) => (
          <a href={href} rel="nofollow noopener ugc noreferrer" target="_blank">
            {c}
          </a>
        ),
      }}
    >
      {children}
    </Markdown>
  )
}
