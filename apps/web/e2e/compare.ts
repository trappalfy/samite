import { readFileSync } from "node:fs"
import { expect, test, type Browser } from "@playwright/test"

const dataUrl = (png: Buffer | string) =>
  `data:image/png;base64,${(typeof png === "string" ? readFileSync(png) : png).toString("base64")}`

/**
 * Share of pixels whose largest channel difference is over `tol` (0..1), after scaling `ours` to the size of `ref`.
 * Runs in a blank browser page so we need no image library.
 */
/**
 * The references were rendered on macOS. Elsewhere (Linux CI) text is rasterised and advanced differently, so
 * both images are compared at 1/4 size: anti-aliasing averages out, layout breakage still shows.
 */
export const REF_PLATFORM = process.platform === "darwin"
const DOWNSCALE = Number(process.env.SAMITE_DOWNSCALE) || (REF_PLATFORM ? 1 : 4)

export async function pixelDiff(
  browser: Browser,
  ours: Buffer,
  ref: string,
  tol = 48,
  /** compare only rows [y0, y1) of the reference with rows [y0 + oursOffset, …) of ours, both at the ref's scale */
  region?: { y0: number; y1: number; oursOffset?: number },
): Promise<number> {
  const down = DOWNSCALE
  const page = await browser.newPage()
  try {
    return await page.evaluate(
      async ({ a, b, tol, region, down }) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((r, j) => {
            const i = new Image()
            i.onload = () => r(i)
            i.onerror = j
            i.src = src
          })
        const [ia, ib] = await Promise.all([load(a), load(b)])
        const w = ib.naturalWidth
        const y0 = region?.y0 ?? 0,
          h = (region?.y1 ?? ib.naturalHeight) - y0,
          off = region?.oursOffset ?? 0
        // ours is scaled to the reference's width; full-page shots of different heights keep their own scale
        const scale = w / ia.naturalWidth
        const W = Math.max(1, Math.round(w / down)),
          Hh = Math.max(1, Math.round(h / down))
        // Cut the region out at the reference's scale first, then shrink it. Shrinking the whole image with an offset
        // would sample each image on a grid that depends on `top` mod `down`, and two halftone prints sampled out of
        // phase differ a lot (6% instead of 0% for the same footer band, Nov 13).
        const px = (img: HTMLImageElement, top: number) => {
          const k = img === ia ? scale : 1
          const full = document.createElement("canvas")
          full.width = w
          full.height = h
          const f = full.getContext("2d")!
          f.imageSmoothingQuality = "high"
          f.drawImage(img, 0, -top, w, img.naturalHeight * k)
          if (down === 1) return f.getImageData(0, 0, w, h).data
          const c = document.createElement("canvas")
          c.width = W
          c.height = Hh
          const x = c.getContext("2d")!
          x.imageSmoothingQuality = "high"
          x.drawImage(full, 0, 0, W, Hh)
          return x.getImageData(0, 0, W, Hh).data
        }
        const pa = px(ia, y0 + off),
          pb = px(ib, y0)
        let n = 0
        for (let i = 0; i < pa.length; i += 4) {
          const d = Math.max(
            Math.abs(pa[i]! - pb[i]!),
            Math.abs(pa[i + 1]! - pb[i + 1]!),
            Math.abs(pa[i + 2]! - pb[i + 2]!),
          )
          if (d > tol) n++
        }
        return n / (W * Hh)
      },
      { a: dataUrl(ours), b: dataUrl(ref), tol, region, down },
    )
  } finally {
    await page.close()
  }
}

/** Saves ours and the reference next to each other as one PNG (for docs/PROGRESS.md). */
export async function sideBySide(browser: Browser, ours: Buffer, ref: string, out: string, cssWidth: number) {
  const page = await browser.newPage({ viewport: { width: cssWidth * 2 + 24, height: 200 }, deviceScaleFactor: 1 })
  try {
    await page.setContent(`<body style="margin:0;background:#222;display:flex;gap:24px;align-items:flex-start;font:12px monospace;color:#aaa">
      <figure style="margin:0;width:${cssWidth}px"><img style="width:100%;display:block" src="${dataUrl(ref)}"><figcaption style="padding:6px">reference</figcaption></figure>
      <figure style="margin:0;width:${cssWidth}px"><img style="width:100%;display:block" src="${dataUrl(ours)}"><figcaption style="padding:6px">ours</figcaption></figure></body>`)
    await page.waitForFunction(() => [...document.images].every((i) => i.complete))
    await page.screenshot({ path: out, fullPage: true })
  } finally {
    await page.close()
  }
}

/**
 * `expect(diff).toBeLessThan(max)`, but a failing check first attaches both images to the report, so a mismatch seen
 * only in CI (Linux) can be looked at instead of guessed at.
 */
export async function expectMatch(diff: number, max: number, ours: Buffer, ref: string, label = "") {
  if (diff >= max) {
    await test.info().attach(`ours${label ? ` (${label})` : ""}`, { body: ours, contentType: "image/png" })
    await test.info().attach(`reference${label ? ` (${label})` : ""}`, { path: ref, contentType: "image/png" })
  }
  expect(diff, label || undefined).toBeLessThan(max)
}
