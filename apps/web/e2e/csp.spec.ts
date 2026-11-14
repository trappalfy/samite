import { expect, test, type Page } from "@playwright/test"

// The Content-Security-Policy (lib/csp.ts, proxy.ts): every page works under it, nothing the page needs is blocked,
// and an injected script doesn't run. Desktop only: the policy doesn't depend on the viewport. CI has no database,
// so pages that read the index are opened with ?example (the M3 acceptance run covers them on live data).
const M = "9be2Kq7xR4mW1pZ8vN3tL6yB5cH2dJ0sFgTn04aa"
const PAGES = [
  "/",
  "/?shot&t=3",
  "/jobs?example",
  "/jobs/new",
  "/jobs/0415?example",
  `/machines/${M}?example`,
  "/machines?example",
  "/me",
  "/docs",
  "/docs/escrow",
  "/terms",
  "/privacy",
]

/** Every CSP violation the page reports, from the browser's event and its console. */
async function watch(page: Page) {
  const seen: string[] = []
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener("securitypolicyviolation", (e) =>
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI || "inline"}`),
    )
  })
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) seen.push(m.text())
  })
  return async () => [...seen, ...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp))]
}

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "the policy is the same on phones"))

for (const path of PAGES)
  test(`${path} runs under the policy with nothing blocked`, async ({ page }) => {
    const violations = await watch(page)
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    const res = await page.goto(path)
    expect(res!.headers()["content-security-policy"]).toContain("'strict-dynamic'")
    await page.waitForLoadState("networkidle")
    // hydrated: React attached its handlers (the html element gets .js from the nonce'd inline script)
    await expect(page.locator("html")).toHaveClass(/\bjs\b/)
    expect(await violations()).toEqual([])
    expect(errors).toEqual([])
  })

test("moving between pages and opening the wallet dialog blocks nothing", async ({ page }) => {
  const violations = await watch(page)
  // client-side navigation from the landing: the landing's policy stays in force for the next page's scripts
  await page.goto("/")
  await page.getByRole("link", { name: "Docs", exact: true }).first().click()
  await page.waitForURL("**/docs")
  await page
    .getByRole("button", { name: /connect/i })
    .first()
    .click()
  await page.keyboard.press("Escape")
  await page.goto("/jobs?example")
  await page.getByRole("link", { name: "Docs", exact: true }).first().click()
  await page.waitForURL("**/docs")
  await page.waitForLoadState("networkidle")
  expect(await violations()).toEqual([])
})

test("each response gets its own nonce, and every script in the HTML carries it", async ({ request }) => {
  const get = async () => {
    const r = await request.get("/jobs?example")
    return { nonce: /'nonce-([^']+)'/.exec(r.headers()["content-security-policy"]!)?.[1], html: await r.text() }
  }
  const [a, b] = [await get(), await get()]
  expect(a.nonce).toBeTruthy()
  expect(a.nonce).not.toBe(b.nonce)
  const scripts = a.html.match(/<script\b[^>]*>/g) ?? []
  expect(scripts.length).toBeGreaterThan(0)
  for (const tag of scripts) expect(tag).toContain(`nonce="${a.nonce}"`)
})

test("markup injected into the page can't run code", async ({ page }) => {
  const violations = await watch(page)
  await page.goto("/jobs?example")
  const ran = await page.evaluate(async () => {
    const w = window as unknown as { __injected?: boolean }
    // what an HTML injection would add: an inline event handler (inline <script> in innerHTML never runs anyway)
    const d = document.createElement("div")
    d.innerHTML = `<img src="data:," onload="window.__injected = true" onerror="window.__injected = true">`
    document.body.append(d)
    await new Promise((r) => setTimeout(r, 300))
    return w.__injected === true
  })
  expect(ran).toBe(false)
  expect((await violations()).join("\n")).toContain("script-src")
})
