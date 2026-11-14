/**
 * A fetch that adds the site's access key (`x-samite-access`) to requests for the site itself, and to nothing else:
 * not to storage upload URLs, not to a host that only starts like the site's. Before launch samite.fun answers only
 * the team; without a key this is the plain fetch.
 */
export function siteFetch(base: typeof fetch, api: string, accessKey: string | undefined): typeof fetch {
  if (!accessKey) return base
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(api + "/")) return base(input, init)
    const headers = new Headers(init?.headers)
    headers.set("x-samite-access", accessKey)
    return base(input, { ...init, headers })
  }
}
