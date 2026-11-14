import { execFileSync } from "node:child_process"
import { expect, test, type Page } from "@playwright/test"
import { kit } from "./ref"

// design/motion/landing-hero.mp4: frame n shows the hero at t = 1.4 + n/30 (like the placeholder's video).
// design/motion/landing-footer-word.mp4 is a real-time capture compressed to 7.2 s: frame n ≈ t 0.749 + 0.1591·n
// (least squares over 11 scatter frames, residuals ≤ 0.11 s), so footer frames are matched within ±0.15 s.
// Errors are mean |predicted − video| on the red channel (0..255), predicted from the canvases' pixels.

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const frame = (video: string, n: number) =>
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      kit(`motion/${video}`),
      "-vf",
      `select=eq(n\\,${n})`,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-",
    ],
    { maxBuffer: 64 << 20 },
  ).toString("base64")

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

async function open(page: Page) {
  await page.goto("/?shot&t=0")
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => ((window as unknown as { __presses?: unknown[] }).__presses?.length ?? 0) >= 8)
}

/** Error of the video frame against every t in `ts`; `which` picks how to predict pixels. */
function errors(page: Page, png: string, ts: number[], which: "hero" | "footer") {
  return page.evaluate(
    async ({ png, ts, which }) => {
      const presses = (window as unknown as { __presses: { seek(t: number): void }[] }).__presses
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const grab = (cv: HTMLCanvasElement, y: number, h: number) => {
        const c = document.createElement("canvas")
        c.width = cv.width
        c.height = h
        const x = c.getContext("2d")!
        const box = cv.getBoundingClientRect()
        x.drawImage(img, box.x, y, cv.width, h, 0, 0, cv.width, h)
        return x.getImageData(0, 0, cv.width, h).data
      }
      if (which === "hero") {
        const cv = document.querySelectorAll("canvas")[1] as HTMLCanvasElement // [0] is the dot chart
        const h = Math.floor(cv.height * 0.8) // the button and caption sit over the bottom of the panel
        const fd = grab(cv, cv.getBoundingClientRect().y, h)
        const cx = cv.getContext("2d")!
        return ts.map((t) => {
          presses.forEach((p) => p.seek(t))
          const d = cx.getImageData(0, 0, cv.width, h).data
          let e = 0,
            m = 0
          for (let i = 0; i < d.length; i += 16) {
            e += Math.abs(242 - (d[i + 3]! * 232) / 255 - fd[i]!)
            m++
          }
          return e / m
        })
      }
      const [clouds, word] = [...document.querySelectorAll("footer canvas")] as HTMLCanvasElement[]
      // the word canvas is the top 62% of the band in the video; on the page it is moved down to the band's middle
      // (the owner's change, Nov 13), so it is composed over the band's top, where the video has it
      const h = word!.height
      const fd = grab(word!, 0, h)
      const cl = clouds!.getContext("2d")!.getImageData(0, 0, word!.width, h).data
      const wx = word!.getContext("2d")!
      return ts.map((t) => {
        presses.forEach((p) => p.seek(t))
        const d = wx.getImageData(0, 0, word!.width, h).data
        let e = 0,
          m = 0
        for (let i = 0; i < d.length; i += 16) {
          const a = d[i + 3]! / 255
          e += Math.abs(a * 242 + (1 - a) * ((cl[i + 3]! / 255) * 0x3a) - fd[i]!)
          m++
        }
        return e / m
      })
    },
    { png, ts, which },
  )
}

test("the hero matches landing-hero.mp4 frame for frame", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || !hasFfmpeg(), "desktop only; needs ffmpeg")
  await open(page)
  for (const n of [0, 90, 180, 270]) {
    const t = 1.4 + n / 30
    const [exact, ...far] = await errors(page, frame("landing-hero.mp4", n), [t, t - 1, t + 1, t - 2, t + 2], "hero")
    expect(exact!, `frame ${n}: error at its t`).toBeLessThan(12)
    expect(exact!, `frame ${n}: its t beats t ± 1 s and ± 2 s`).toBeLessThan(Math.min(...far) - 1)
  }
})

test("the footer word matches landing-footer-word.mp4 within the capture's jitter", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || !hasFfmpeg(), "desktop only; needs ffmpeg")
  await open(page)
  await page.locator("footer").scrollIntoViewIfNeeded()
  for (const n of [23, 68, 113, 203]) {
    const fit = 0.749 + 0.1591 * n
    const near = Array.from({ length: 61 }, (_, i) => fit - 0.15 + i * 0.005)
    const png = frame("landing-footer-word.mp4", n)
    const best = Math.min(...(await errors(page, png, near, "footer")))
    const [away] = await errors(page, png, [fit + 0.6], "footer")
    expect(best, `frame ${n}: best error near t ${fit.toFixed(2)}`).toBeLessThan(7)
    expect(away!, `frame ${n}: 0.6 s away it no longer matches`).toBeGreaterThan(best + 10)
  }
})
