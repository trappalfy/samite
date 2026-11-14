import "server-only"
// Live data from the index, or the labelled example data of the design (?example, or SAMITE_EXAMPLE_DATA=1 on a
// preview with no index). Every example value on screen carries its label (CLAUDE.md §0).
export type Search = Promise<Record<string, string | string[] | undefined>>

export async function isExample(searchParams?: Search): Promise<boolean> {
  if (process.env.SAMITE_EXAMPLE_DATA === "1") return true
  return !!searchParams && "example" in (await searchParams)
}

/** Keeps example mode on links inside example pages. */
export const inMode = (href: string, example: boolean) =>
  example ? `${href}${href.includes("?") ? "&" : "?"}example` : href

/** Unix seconds for this request. Server pages render per request, so "now" belongs to the request, not the component. */
export const requestTime = () => Math.floor(Date.now() / 1000)
