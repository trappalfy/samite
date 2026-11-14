// The Privy layer end to end, by hand (not in CI: it needs a Privy app, and Privy only serves the origins allowed in
// its dashboard). Build with NEXT_PUBLIC_PRIVY_APP_ID, serve it on localhost:3000 against the local harness with a
// worker running (docs/RUNBOOK.md, "Privy"), then `pnpm --filter web e2e:privy`. The injected test wallet shows up in
// Privy's modal like any Wallet Standard wallet; it connects, reconnects silently after a reload, signs in, posts.
import { expect, test } from "@playwright/test"
import { loadSigners } from "@samite/local"
import { injectTestWallet } from "./test-wallet"

test("connect through Privy, reconnect after a reload, sign in and post a job", async ({ page }) => {
  const k = await loadSigners()
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  // nothing Privy needs may be blocked by the site's policy (lib/csp.ts)
  const blocked: string[] = []
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) blocked.push(m.text())
  })
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`Content Security Policy: ${e.violatedDirective} ${e.blockedURI}`),
    ),
  )
  const wallet = await injectTestWallet(page, k.poster)

  await page.goto("/jobs")
  await page.getByRole("button", { name: "Connect wallet" }).click()
  await expect(page.locator("#privy-modal-content")).toContainText("Samite Test Wallet")
  await page.getByRole("button", { name: /Samite Test Wallet/ }).click()
  const chip = page.getByRole("button", { name: `Wallet ${k.poster.address}` })
  await expect(chip).toBeVisible({ timeout: 30_000 })

  // a full page load: the wallet comes back without a click
  await page.goto("/jobs/new")
  await expect(chip).toBeVisible({ timeout: 30_000 })

  await page.getByLabel("Title").fill("Check 50 product pages for broken images")
  await page.getByLabel("Instructions (Markdown)").fill("Pages are public on example.com. List each broken image URL.")
  await page.getByLabel("Accepted when").fill("All 50 pages checked\nOne row per broken image")
  await page.getByLabel("Reward", { exact: true }).fill("12")
  await page.getByRole("button", { name: "Lock 12 USDC and post" }).click()
  await page.waitForURL(/\/jobs\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, { timeout: 120_000 })
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check 50 product pages for broken images")
  expect(wallet.map((w) => w.kind)).toEqual(["signIn", "tx"]) // one sign-in, one transaction, both through Privy
  expect(errors).toEqual([])
  expect(blocked).toEqual([])
})
