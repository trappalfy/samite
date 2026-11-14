import { mkdirSync } from "node:fs"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import { expectMatch, pixelDiff, sideBySide } from "./compare"
import { kit } from "./ref"

// The landing (CLAUDE.md §11.10) against design/screenshots/landing-*.png. The references were taken at t = 3 s.
const T = 3
const PROGRESS = new URL("../../../docs/progress/m1/", import.meta.url).pathname
// macOS: strict, the references were made there. Linux (CI): 1/4 size (compare.ts) and 5%, because glyphs our fonts
// lack (→, …) come from different system fonts and re-wrap a line or two (measured 2.2–3.9%); a wrong t gives 7–9%.
const MAX_DIFF = process.platform === "darwin" ? 0.006 : 0.05
const BAND_MAX = process.platform === "darwin" ? MAX_DIFF * 2.5 : 0.05

async function ready(page: Page, url = `/?shot&t=${T}`) {
  await page.goto(url)
  await page.evaluate(() => document.fonts.ready)
  // the photo presses (figure, clouds) start after the load event
  await page.waitForFunction(() => ((window as unknown as { __presses?: unknown[] }).__presses?.length ?? 0) >= 8)
  await page.waitForTimeout(300)
}

const save = async (browser: Parameters<typeof sideBySide>[0], shot: Buffer, ref: string, name: string, w: number) => {
  if (process.env.UPDATE_PROGRESS !== "1") return
  mkdirSync(PROGRESS, { recursive: true })
  await sideBySide(browser, shot, ref, `${PROGRESS}${name}.png`, w)
}

test("first screen matches the reference", async ({ page, browser }, info) => {
  await ready(page)
  const shot = await page.screenshot()
  const name = info.project.name === "mobile" ? "landing-mobile-hero" : "landing-hero"
  const ref = kit(`screenshots/${name}.png`)
  await save(browser, shot, ref, name, info.project.name === "mobile" ? 390 : 1440)
  const diff = await pixelDiff(browser, shot, ref)
  info.annotations.push({ type: "pixel diff", description: `${(diff * 100).toFixed(3)}%` })
  await expectMatch(diff, MAX_DIFF, shot, ref)
})

// The owner's changes since the references (Nov 13, docs/DECISIONS.md): the four step pictures are the eye in four
// states, on 160 px canvases instead of the prototype's 110 (so everything below a row of steps sits 50 px lower), and
// the footer word sits in the middle of its band (the same canvas and print, moved down). Everything else is compared
// with the references as it was; the steps' pictures and the word's position have their own checks below.
const REF_GLYPH_H = 110

test("the whole page matches the reference above the footer, and the footer band", async ({ browser }, info) => {
  const mobile = info.project.name === "mobile"
  const dpr = mobile ? 2 : 1 // the full-page references are 390@2 and 1440@1
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: dpr,
  })
  await ready(page)
  const shot = await page.screenshot({ fullPage: true })
  const ref = kit(`screenshots/landing-${mobile ? "mobile" : "desktop"}-full.png`)
  const m = await page.evaluate(() => {
    const top = (e: Element) => e.getBoundingClientRect().top + window.scrollY
    const f = document.querySelector("footer")!
    const steps = [...document.querySelectorAll("[class*=step] canvas")].map((c) => c.parentElement!)
    const rows = new Set(steps.map((e) => Math.round(top(e)))).size
    const last = steps[steps.length - 1]!
    return {
      footTop: top(f),
      artH: f.firstElementChild!.getBoundingClientRect().height,
      stepsTop: Math.min(...steps.map(top)),
      stepsBottom: top(last) + last.getBoundingClientRect().height,
      rows,
      glyphH: steps[0]!.querySelector("canvas")!.getBoundingClientRect().height,
    }
  })
  const shift = m.rows * (m.glyphH - REF_GLYPH_H)
  await save(browser, shot, ref, `landing-${mobile ? "mobile" : "desktop"}-full`, mobile ? 390 : 720)
  // the reference's footer has three links we hide until they have somewhere to go (§11.10), so compare the page
  // above the footer (above the steps as it is, below them moved up by the taller pictures) and the footer's band
  const r = (v: number) => Math.round(v * dpr)
  const above = await pixelDiff(browser, shot, ref, 48, { y0: 0, y1: r(m.stepsTop) })
  const below = await pixelDiff(browser, shot, ref, 48, {
    y0: r(m.stepsBottom - shift),
    y1: r(m.footTop - shift),
    oursOffset: r(shift),
  })
  // the band with the word's canvas where the reference has it (the print itself is unchanged)
  await page.locator("[data-footer-word]").evaluate((e) => ((e as HTMLElement).style.top = "0px"))
  await page.waitForTimeout(100)
  const bandShot = await page.locator("footer > *").first().screenshot()
  const band = await pixelDiff(browser, bandShot, ref, 48, {
    y0: r(m.footTop - shift),
    y1: r(m.footTop - shift + m.artH),
    oursOffset: -r(m.footTop - shift),
  })
  info.annotations.push({
    type: "pixel diff",
    description: `above the steps ${(above * 100).toFixed(3)}%, below ${(below * 100).toFixed(3)}%, band ${(band * 100).toFixed(3)}%`,
  })
  // the share of differing pixels over both parts together, as the bound was set for the whole page above the footer
  const hAbove = m.stepsTop,
    hBelow = m.footTop - m.stepsBottom
  await expectMatch((above * hAbove + below * hBelow) / (hAbove + hBelow), MAX_DIFF, shot, ref, "above the footer")
  // the cycling word is printed with 5 px dots on phones; a one-dot shift counts twice, so the band gets more room
  await expectMatch(band, BAND_MAX, bandShot, ref, "footer band")
  await page.close()
})

test("the footer word is in the middle of its band, and the footer button's label in the middle of the button", async ({
  page,
}) => {
  await ready(page, "/?shot&t=0.5") // the crisp ink stage of the cycle
  const { inkMiddle, bandMiddle, cell } = await page.evaluate(() => {
    const band = document.querySelector("footer > *")!.getBoundingClientRect()
    const c = document.querySelector("[data-footer-word] canvas") as HTMLCanvasElement
    const box = c.getBoundingClientRect()
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data
    let first = -1,
      last = -1
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3]! > 128) {
          if (first < 0) first = y
          last = y
          break
        }
    const k = box.height / c.height
    return {
      inkMiddle: box.top + ((first + last) / 2) * k,
      bandMiddle: band.top + band.height / 2,
      cell: window.innerWidth < 600 ? 5 : 8,
    }
  })
  expect(Math.abs(inkMiddle - bandMiddle)).toBeLessThanOrEqual(cell)

  const button = page.locator("footer").getByRole("link", { name: "Post a job" }).first()
  const b = await button.evaluate((e) => {
    const r = e.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(e)
    const t = range.getBoundingClientRect()
    return { box: r.top + r.height / 2, label: t.top + t.height / 2, height: r.height }
  })
  expect(b.height).toBe(54)
  expect(Math.abs(b.label - b.box)).toBeLessThanOrEqual(1.5)
})

test("each step shows its picture inside its cell", async ({ page }) => {
  await ready(page)
  const steps = await page.locator("[class*=step] canvas").evaluateAll((cs) =>
    (cs as HTMLCanvasElement[]).map((c) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data
      let ink = 0,
        right = 0
      for (let i = 3; i < d.length; i += 4)
        if (d[i]! > 128) {
          ink++
          right = Math.max(right, ((i - 3) / 4) % c.width)
        }
      return { ink, right, width: c.width }
    }),
  )
  expect(steps).toHaveLength(4)
  for (const s of steps) {
    expect(s.ink).toBeGreaterThan(500)
    expect(s.right).toBeLessThan(s.width - 1) // nothing cut off at the cell's edge
  }
})

test("labels every example value", async ({ page }) => {
  await ready(page)
  for (const label of ["example values; live from /api/v1/stats in production", "example job, time sped up"])
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  await expect(page.locator("#jobs").getByText("example", { exact: true })).toBeVisible()
})

test("hides links with nowhere to go and keeps the rest working", async ({ page }, info) => {
  await ready(page)
  for (const dead of ["Status", "GitHub", "Program on Solscan"])
    await expect(page.getByRole("link", { name: dead })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "X", exact: true })).toHaveAttribute("href", "https://x.com/samitefun")
  await expect(page.getByRole("link", { name: "Launch app" })).toHaveAttribute("href", "/jobs")
  // the nav (the menu on narrow screens) goes to the site's pages, not to sections of this one
  let nav = page.getByRole("navigation", { name: "Site" })
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Menu" }).click()
    nav = page.locator("#site-menu")
  }
  for (const [name, href] of [
    ["Jobs", "/jobs"],
    ["Machines", "/machines"],
    ["Escrow", "/docs/escrow"],
    ["Docs", "/docs"],
  ] as const)
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href)
})

test("code tabs switch between MCP, SDK and HTTP", async ({ page }) => {
  await ready(page)
  const panel = page.getByRole("tabpanel")
  await expect(panel).toContainText("@samite/mcp")
  await page.getByRole("tab", { name: "SDK" }).click()
  await expect(panel).toContainText("createSamite({ rpc, signer })")
  await page.getByRole("tab", { name: "SDK" }).press("ArrowRight")
  await expect(page.getByRole("tab", { name: "HTTP" })).toBeFocused()
  await expect(panel).toContainText("Samite-Ed25519")
})

test("the menu opens the links and closes on Escape", async ({ page }) => {
  await ready(page)
  const menu = page.getByRole("button", { name: "Menu" })
  await menu.click()
  await expect(menu).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator("#site-menu").getByRole("link", { name: "Escrow" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toHaveAttribute("aria-expanded", "false")
})

test("never scrolls sideways", async ({ page }) => {
  for (const width of [390, 560, 1100, 1101, 1120, 1200, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await ready(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `width ${width}`).toBeLessThanOrEqual(width)
  }
})

test("has no axe violations", async ({ page }) => {
  await ready(page)
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([])
})

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" })
  test("holds still: the HUD shows PAID, the highlight stays put", async ({ page }) => {
    await page.goto("/")
    await page.waitForTimeout(1500)
    const hero = page.locator("canvas").nth(1)
    const a = await hero.screenshot()
    const who = await page.getByText("Agents", { exact: true }).getAttribute("class")
    await page.waitForTimeout(2700)
    expect((await hero.screenshot()).equals(a)).toBe(true)
    expect(await page.getByText("Agents", { exact: true }).getAttribute("class")).toBe(who)
  })
})

// moved here with the placeholder's removal (Nov 13): the home page is the landing now
test("the home page carries the title, the social card tags and the hardening headers", async ({ page, request }) => {
  await ready(page)
  await expect(page).toHaveTitle("Samite: the job board for machines")
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /^https:\/\/samite\.fun\/opengraph-image/,
  )
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://samite.fun")
  const r = await request.get("/")
  expect(r.headers()["x-frame-options"]).toBe("DENY")
  expect(r.headers()["x-content-type-options"]).toBe("nosniff")
  for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"])
    expect(r.headers()["content-security-policy"]).toContain(d)
  expect(r.headers()["strict-transport-security"]).toContain("max-age=")
})
