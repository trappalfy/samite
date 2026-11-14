import type { MDXComponents } from "mdx/types"
import type { ComponentPropsWithoutRef } from "react"

// Docs are styled by the .prose container (app/(preview)/(app)/docs/docs.module.css).
// Code blocks scroll sideways, so they take keyboard focus (WCAG: scrollable regions are reachable).
const components: MDXComponents = {
  pre: (props: ComponentPropsWithoutRef<"pre">) => <pre tabIndex={0} {...props} />,
}

export function useMDXComponents(): MDXComponents {
  return components
}
