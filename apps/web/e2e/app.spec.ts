import { mkdirSync } from "node:fs"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import { expectMatch, pixelDiff, sideBySide } from "./compare"
import { kit } from "./ref"

// The app's four screens (CLAUDE.md §11.12) against design/screenshots/app-*.png, with example data.
const M = "9be2Kq7xR4mW1pZ8vN3tL6yB5cH2dJ0sFgTn04aa"
const PROGRESS = new URL("../../../docs/progress/m1/", import.meta.url).pathname
// macOS: strict, the references were made there. Linux (CI): 1/4 size (compare.ts) and 5%, because glyphs our fonts
// lack (→, …) come from different system fonts and re-wrap a line or two (measured 2.2–3.9%); a wrong t gives 7–9%.
const MAX_DIFF = process.platform === "darwin" ? 0.01 : 0.05

const SCREENS = [
  { name: "board", path: "/jobs", mobile: true },
  { name: "new", path: "/jobs/new", mobile: false },
  { name: "job", path: "/jobs/0415", mobile: true },
  { name: "machine", path: `/machines/${M}`, mobile: true },
]

for (const sc of SCREENS) {
  test(`${sc.name} matches the reference`, async ({ browser }, info) => {
    const mobile = info.project.name === "mobile"
    test.skip(mobile && !sc.mobile, "no phone reference for this screen")
    // desktop references are full pages at 1440@1; phone references are the first screen at 390×844@3
    const page = await browser.newPage(
      mobile
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }
        : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    )
    await page.goto(`${sc.path}?shot&t=3&example`)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)
    const shot = await page.screenshot({ fullPage: !mobile })
    const ref = kit(`screenshots/app-${mobile ? "mobile-" : ""}${sc.name}.png`)
    if (process.env.UPDATE_PROGRESS === "1") {
      mkdirSync(PROGRESS, { recursive: true })
      await sideBySide(
        browser,
        shot,
        ref,
        `${PROGRESS}app-${mobile ? "mobile-" : ""}${sc.name}.png`,
        mobile ? 390 : 720,
      )
    }
    const diff = await pixelDiff(browser, shot, ref)
    info.annotations.push({ type: "pixel diff", description: `${(diff * 100).toFixed(3)}%` })
    await expectMatch(diff, MAX_DIFF, shot, ref)
    await page.close()
  })
}

test("the board filters by category and poster, and sorts", async ({ page }) => {
  await page.goto("/jobs?example")
  const titles = page.locator("tbody tr td:first-child a, tbody tr td:first-child span:first-child")
  await page.getByRole("button", { name: "Code", exact: true }).click()
  await expect(page.locator("tbody tr")).toHaveCount(1)
  await expect(page.locator("tbody")).toContainText("Write unit tests for a Rust crate")
  await page.getByRole("button", { name: "All", exact: true }).click()
  await page.getByRole("button", { name: "Machines", exact: true }).click()
  await expect(page.locator("tbody tr")).toHaveCount(3)
  await page.getByRole("button", { name: "Anyone", exact: true }).click()
  await page.getByRole("button", { name: "Reward", exact: true }).click()
  await expect(titles.first()).toHaveText("Photograph shelf stock at 12 stores")
})

test("the post form keeps the summary honest", async ({ page }) => {
  await page.goto("/jobs/new?example")
  const reward = page.getByLabel("Reward", { exact: true })
  await reward.fill("80")
  const summary = page.getByRole("region", { name: "Summary" })
  await expect(summary).toContainText("Machine receives (97.5%)78.00 USDC")
  await expect(summary).toContainText("Samite fee (2.5%)2.00 USDC")
  await expect(page.getByRole("button", { name: "Lock 80 USDC and post" })).toBeEnabled()
  // the parts are exact, so they add up to the reward (1.00 = 0.975 + 0.025, not 0.98 + 0.03)
  for (const [r, machine, fee] of [
    ["1", "0.975", "0.025"],
    ["5", "4.875", "0.125"],
    ["1.23", "1.19925", "0.03075"],
  ]) {
    await reward.fill(r!)
    await expect(summary).toContainText(`Machine receives (97.5%)${machine} USDC`)
    await expect(summary).toContainText(`Samite fee (2.5%)${fee} USDC`)
  }
  for (const r of ["0.999999", "1.234567"]) {
    await reward.fill(r)
    await expect(page.getByText("Enter an amount in USDC with at most 2 decimals, like 120.00.")).toBeVisible()
    // no amount on the button until there is a valid one; the button still answers (next test)
    await expect(page.getByRole("button", { name: "Lock USDC and post" })).toBeEnabled()
  }
  await reward.fill("0.5")
  await expect(page.getByText("The reward is at least 1.00 USDC.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Lock USDC and post" })).toBeEnabled()
  await reward.fill("12,5x")
  await expect(page.getByText("Enter an amount in USDC with at most 2 decimals, like 120.00.")).toBeVisible()
  await page.getByRole("radio", { name: /Proven machines/ }).click()
  await expect(page.getByRole("radio", { name: /Proven machines/ })).toHaveAttribute("aria-checked", "true")
})

test("the post button always answers: it lists what to fix, and each item leads to its field", async ({ page }) => {
  await page.goto("/jobs/new?example")
  await page.getByLabel("Title").fill("Haiku")
  await page.getByLabel("Instructions (Markdown)").fill("")
  await page.getByLabel("Accepted when").fill("")
  const post = page.getByRole("button", { name: /Lock .* and post/ })
  await expect(post).toBeEnabled()
  await post.click()
  const fix = page.getByRole("alert").filter({ hasText: "Fix this to post" })
  await expect(fix).toContainText("Title must be 8–120 characters (it has 5).")
  await expect(fix).toContainText("Instructions can't be blank.")
  await expect(fix).toContainText("Acceptance criteria must have 1–10 items (there are 0).")
  await expect(page.getByText(/Example: on the live board/)).toBeHidden()
  // the same words under the field itself, which is marked invalid
  await expect(page.getByLabel("Title")).toHaveAttribute("aria-invalid", "true")
  await fix.getByRole("button", { name: /Instructions can't be blank/ }).click()
  await expect(page.getByLabel("Instructions (Markdown)")).toBeFocused()
  // everything fixed: the list goes away and the button does its job
  await page.getByLabel("Title").fill("Write a haiku about escrow")
  await page.getByLabel("Instructions (Markdown)").fill("Three lines, 5-7-5 syllables, about USDC waiting in escrow.")
  await page.getByLabel("Accepted when").fill("It is a haiku (5-7-5)")
  await expect(fix).toBeHidden()
  await post.click()
  await expect(page.getByText(/Example: on the live board/)).toBeVisible()
})

test("an empty form says nothing until you try, and never asks the wallet before it's valid", async ({ page }) => {
  await page.goto("/jobs/new")
  await expect(page.getByText(/Title must be/)).toHaveCount(0)
  await expect(page.locator("[aria-invalid=true]")).toHaveCount(0)
  await page.getByRole("button", { name: /Lock .* and post/ }).click()
  const fix = page.getByRole("alert").filter({ hasText: "Fix this to post" })
  await expect(fix).toContainText("Title can't be blank.")
  await expect(fix).toContainText("Enter an amount in USDC")
  // the wallet comes after the form: no "connect a wallet" while the form itself is wrong
  await expect(page.getByText("Connect a wallet first (top right).")).toHaveCount(0)
})

test("a job being written survives a reload, in this browser, until it is cleared", async ({ page }) => {
  await page.goto("/jobs/new")
  await page.getByLabel("Title").fill("Write a haiku about escrow")
  await page.getByLabel("Instructions (Markdown)").fill("Three lines, 5-7-5.")
  await page.getByLabel("Accepted when").fill("It is a haiku\nIt mentions USDC")
  await page.getByRole("radio", { name: /^Text/ }).click()
  await page.getByLabel("Category").selectOption("Research")
  await page.getByLabel("Reward", { exact: true }).fill("1.50")
  await page.getByLabel("Deadline").selectOption("24 hours")
  await page.getByRole("radio", { name: /Only these/ }).click()
  await page.getByLabel(/Machine addresses/).fill("CARmgx4r8ZbWZWYtk1skSqJtioKndV97PG89F6SkXZnH")

  await page.reload()
  await expect(page.getByLabel("Title")).toHaveValue("Write a haiku about escrow")
  await expect(page.getByLabel("Instructions (Markdown)")).toHaveValue("Three lines, 5-7-5.")
  await expect(page.getByLabel("Accepted when")).toHaveValue("It is a haiku\nIt mentions USDC")
  await expect(page.getByRole("radio", { name: /^Text/ })).toHaveAttribute("aria-checked", "true")
  await expect(page.getByLabel("Category")).toHaveValue("Research")
  await expect(page.getByLabel("Reward", { exact: true })).toHaveValue("1.50")
  await expect(page.getByLabel("Deadline")).toHaveValue("24 hours")
  await expect(page.getByLabel(/Machine addresses/)).toHaveValue("CARmgx4r8ZbWZWYtk1skSqJtioKndV97PG89F6SkXZnH")
  await expect(page.getByRole("button", { name: "Lock 1.50 USDC and post" })).toBeVisible()

  await page.getByRole("button", { name: "Clear the form" }).click()
  await expect(page.getByLabel("Title")).toHaveValue("")
  await expect(page.locator("[aria-invalid=true]")).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel("Title")).toHaveValue("")
  await expect(page.getByRole("button", { name: "Clear the form" })).toHaveCount(0)
})

test("the example form neither reads nor writes the draft", async ({ page }) => {
  await page.goto("/jobs/new")
  await page.getByLabel("Title").fill("A real draft, kept for the live form")
  await page.goto("/jobs/new?example")
  await expect(page.getByLabel("Title")).toHaveValue("Label 5,000 product images by category")
  await page.getByLabel("Title").fill("An example edit that must not be kept")
  await page.goto("/jobs/new")
  await expect(page.getByLabel("Title")).toHaveValue("A real draft, kept for the live form")
})

test("rejecting needs a public reason of at least 10 characters", async ({ page }) => {
  await page.goto("/jobs/0415?example")
  await page.getByRole("button", { name: "Reject with a reason" }).click()
  const dialog = page.getByRole("dialog", { name: "Reject this delivery" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("This reason is public.")
  const send = dialog.getByRole("button", { name: "Reject with this reason" })
  await dialog.getByLabel("Reason").fill("too short")
  await expect(send).toBeDisabled()
  await dialog.getByLabel("Reason").fill("Rows 12 to 40 have no price.")
  await expect(send).toBeEnabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
})

test("marks the current tab", async ({ page }) => {
  await page.goto("/jobs/new?example")
  await expect(page.getByRole("navigation", { name: "App" }).getByRole("link", { name: "Post a job" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await page.goto(`/machines/${M}?example`)
  await expect(page.getByRole("navigation", { name: "App" }).getByRole("link", { name: "Machines" })).toHaveAttribute(
    "aria-current",
    "page",
  )
})

for (const path of [
  "/jobs",
  "/jobs/new",
  "/jobs/0415",
  `/machines/${M}`,
  "/me",
  "/docs",
  "/docs/quickstart",
  "/docs/escrow",
  "/docs/faq",
]) {
  test(`${path}: no axe violations, no sideways scroll`, async ({ page }) => {
    await page.goto(`${path}${path.startsWith("/docs") ? "?" : "?example&"}shot&t=3`)
    await page.waitForTimeout(300)
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([])
    const w = page.viewportSize()!.width
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w)
  })
}

test("every docs page says it is a draft, and none talks about a token", async ({ page }) => {
  for (const path of [
    "/docs",
    "/docs/quickstart",
    "/docs/escrow",
    "/docs/fees",
    "/docs/job-spec",
    "/docs/delivery",
    "/docs/signed-requests",
    "/docs/errors",
    "/docs/faq",
  ]) {
    await page.goto(path.startsWith("/docs") ? path : `${path}?example`)
    await expect(page.getByText("Nothing here is live yet.", { exact: false }), path).toBeVisible()
    await expect(page.locator("main"), path).not.toContainText(/\btoken\b(?! account)/i)
  }
})

test("the terms and privacy pages are final, name X as the contact, never claim an audit, and pass axe", async ({
  page,
}) => {
  for (const path of ["/terms", "/privacy"]) {
    await page.goto(path)
    await expect(page.getByText("DRAFT", { exact: false }), path).toHaveCount(0)
    await expect(page.getByText("Last updated:", { exact: false }), path).toBeVisible()
    await expect(page.getByRole("link", { name: "@samitefun" }), path).toHaveAttribute(
      "href",
      "https://x.com/samitefun",
    )
    await expect(page.locator("main"), path).not.toContainText(
      /\baudited\b|guaranteed|trustless|@[a-z0-9.-]+\.[a-z]{2,}/i,
    )
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
    expect(
      r.violations.map((v) => v.id),
      path,
    ).toEqual([])
  }
})

test("example explorer links are plain text until there is somewhere to go", async ({ page }) => {
  await page.goto("/jobs/0415?example")
  await expect(page.locator('a[href="#"]')).toHaveCount(0)
})

test("docs anchors from the landing exist", async ({ page }) => {
  await page.goto("/docs/quickstart")
  for (const id of ["mcp", "sdk", "http"]) await expect(page.locator(`h2#${id}`)).toHaveCount(1)
})
