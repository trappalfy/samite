import { expect, test } from "@playwright/test"
import { kit } from "./ref"

// The TS press must print exactly the pixels of design/prototype/samite-press.js for the same source and t
// (CLAUDE.md §11.5: "same maths, same keyframes, same output for the same t").
test.skip(({ isMobile }) => isMobile, "engine parity runs once, on desktop")

const TIMES = [0.3, 1, 2, 3.2, 3.7, 4.5, 6, 7]

const VARIANTS = {
  "placeholder: dot / cycle": { shape: "dot", schedule: "cycle", period: 6.4 },
  "hero: bayer / breathe, ink on paper": {
    shape: "bayer",
    schedule: "breathe",
    period: 5.2,
    ink: "#0A0A0A",
    glow: 2,
    wide: 9,
    bloom: 0.3,
    cell: 6,
  },
  "figure: square / breathe": {
    shape: "square",
    schedule: "breathe",
    period: 7,
    glow: 1,
    wide: 5,
    gamma: 1.35,
    bloom: 0.2,
    cell: 7,
  },
  "glyph: bayer / still": { shape: "bayer", schedule: "still", glow: 1, wide: 3, intro: 0, cell: 5 },
} as const

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/press-parity")
  await page.waitForSelector("body[data-ready]")
  await page.addScriptTag({ path: kit("prototype/samite-mark.js") })
  await page.addScriptTag({ path: kit("prototype/samite-press.js") })
})

for (const size of [
  { w: 1100, h: 440 },
  { w: 390, h: 520 },
]) {
  for (const [name, variant] of Object.entries(VARIANTS)) {
    test(`${name} at ${size.w}×${size.h}: identical pixels at every t`, async ({ page }) => {
      const diffs = await page.evaluate(
        async ({ w, h, times, variant }) => {
          type Handle = { seek(t: number): void; stop(): void }
          const win = window as unknown as {
            SamitePress: (c: HTMLCanvasElement, o: object) => Handle
            drawSamiteMark: (ctx: CanvasRenderingContext2D, x: number, y: number, h: number) => number
            __port: {
              createPress: (c: HTMLCanvasElement, o: object) => Handle
              cssFontFamily: (v: string, f: string) => string
            }
          }
          const family = win.__port.cssFontFamily("--ff-montserrat", "Montserrat")
          // next/font's fallback face is local("Arial"), which Linux lacks: load() may reject, so wait on ready
          await document.fonts.load(`italic 800 100px ${family}`).catch(() => null)
          await document.fonts.ready
          // the placeholder's lockup, verbatim from the prototype
          const source = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
            const phone = W < 640
            if (phone) {
              const markH = Math.min(H * 0.34, W * 0.42),
                fs = Math.min(W * 0.19, H * 0.2)
              win.drawSamiteMark(ctx, (W - markH * 1.2716) / 2, H * 0.1, markH)
              ctx.font = `italic 800 ${fs}px ${family}`
              ctx.textAlign = "center"
              ctx.fillText("SAMITE", W / 2, H * 0.1 + markH + fs * 0.95)
              return
            }
            const fs = Math.min(H * 0.48, W * 0.165),
              markH = fs * 1.02,
              gap = fs * 0.22
            ctx.font = `italic 800 ${fs}px ${family}`
            const tw = ctx.measureText("SAMITE").width,
              total = markH * 1.2716 + gap + tw
            const x0 = (W - total) / 2,
              cy = H * 0.52
            win.drawSamiteMark(ctx, x0, cy - markH / 2, markH)
            ctx.textAlign = "left"
            ctx.fillText("SAMITE", x0 + markH * 1.2716 + gap, cy + fs * 0.36)
          }
          const mk = () => {
            const c = document.createElement("canvas")
            c.style.cssText = `position:absolute;left:-20000px;top:0;width:${w}px;height:${h}px`
            document.body.appendChild(c)
            return c
          }
          const opts = { cell: w < 640 ? 7 : 9, ...variant, source }
          const ca = mk(),
            cb = mk()
          const a = win.SamitePress(ca, opts)
          const b = win.__port.createPress(cb, opts)
          await document.fonts.ready
          await new Promise((r) => setTimeout(r, 100))
          a.stop()
          b.stop()
          const xa = ca.getContext("2d")!,
            xb = cb.getContext("2d")!
          return times.map((t) => {
            a.seek(t)
            b.seek(t)
            const pa = xa.getImageData(0, 0, ca.width, ca.height).data
            const pb = xb.getImageData(0, 0, cb.width, cb.height).data
            let n = 0,
              lit = 0
            for (let i = 0; i < pa.length; i += 4) {
              if (pa[i + 3]) lit++
              if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2] || pa[i + 3] !== pb[i + 3]) n++
            }
            if (lit === 0 && t > 1.2 && opts.shape !== "bayer") return -1 // an empty print proves nothing
            return n
          })
        },
        { ...size, times: TIMES, variant },
      )
      expect(diffs).toEqual(TIMES.map(() => 0))
    })
  }
}

test("the mark draws the same pixels as the reference", async ({ page }) => {
  const diff = await page.evaluate(() => {
    const win = window as unknown as {
      drawSamiteMark: (ctx: CanvasRenderingContext2D, x: number, y: number, h: number) => number
      __port: { drawSamiteMark: (ctx: CanvasRenderingContext2D, x: number, y: number, h: number) => number }
    }
    const draw = (f: typeof win.drawSamiteMark) => {
      const c = document.createElement("canvas")
      c.width = 400
      c.height = 320
      const x = c.getContext("2d")!
      x.fillStyle = "#fff"
      const width = f(x, 13.5, 7.25, 290)
      return { px: x.getImageData(0, 0, 400, 320).data, width }
    }
    const a = draw(win.drawSamiteMark),
      b = draw(win.__port.drawSamiteMark)
    let n = 0
    for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) n++
    return { n, wa: a.width, wb: b.width }
  })
  expect(diff.n).toBe(0)
  expect(diff.wb).toBe(diff.wa)
})

test("lays out only after every font has settled, even when one fails first", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const port = (window as unknown as { __port: { createPress: (c: HTMLCanvasElement, o: object) => unknown } }).__port
    // control timing: the broken font fails at once (like local("Arial") on Linux), the real one takes 300 ms
    const orig = document.fonts.load.bind(document.fonts)
    let slowDone = false
    document.fonts.load = (font: string, text?: string) =>
      font.includes("Broken")
        ? Promise.reject(new DOMException("A network error occurred.", "NetworkError"))
        : new Promise((res) =>
            setTimeout(() => {
              slowDone = true
              res(orig(font, text))
            }, 300),
          )
    try {
      return await new Promise<{ slowDoneAtLayout: boolean }>((resolve) => {
        const c = document.createElement("canvas")
        c.style.cssText = "position:absolute;left:-20000px;width:300px;height:120px"
        document.body.appendChild(c)
        port.createPress(c, {
          fonts: ['10px "Broken Fallback"', "italic 800 10px Real"],
          source: () => resolve({ slowDoneAtLayout: slowDone }),
        })
      })
    } finally {
      document.fonts.load = orig
    }
  })
  expect(r.slowDoneAtLayout).toBe(true)
})

test("prints with the real face even when the fallback face fails and the font is slow", async ({ browser }) => {
  // like Linux/Android: next/font's fallback is local("Arial"), absent there, and rejects at once
  const page = await browser.newPage()
  await page.route("**/*.woff2", async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.goto("/dev/press-parity", { waitUntil: "commit" })
  await page.waitForSelector("body[data-ready]")
  const r = await page.evaluate(async () => {
    const port = (
      window as unknown as {
        __port: {
          createPress: (c: HTMLCanvasElement, o: object) => unknown
          cssFontFamily: (v: string, f: string) => string
        }
      }
    ).__port
    const broken = new FontFace("Broken Fallback", "local(NoSuchFontXYZ)")
    document.fonts.add(broken)
    const list = `${port.cssFontFamily("--ff-montserrat", "Montserrat")}, "Broken Fallback"`
    const font = `italic 800 100px ${list}`
    const atLayout = await new Promise<number>((resolve) => {
      const c = document.createElement("canvas")
      c.style.cssText = "position:absolute;left:-20000px;width:300px;height:120px"
      document.body.appendChild(c)
      port.createPress(c, {
        fonts: [font],
        source: (ctx: CanvasRenderingContext2D) => {
          ctx.font = font
          resolve(ctx.measureText("SAMITE").width)
        },
      })
    })
    await document.fonts.ready
    const x = document.createElement("canvas").getContext("2d")!
    x.font = font
    return { atLayout, loaded: x.measureText("SAMITE").width }
  })
  expect(r.atLayout).toBeCloseTo(r.loaded, 3)
  await page.close()
})

test("stops drawing in a hidden tab, offscreen and after destroy()", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const port = (
      window as unknown as {
        __port: { createPress: (c: HTMLCanvasElement, o: object) => { start(): void; destroy(): void } }
      }
    ).__port
    let frames = 0
    const c = document.createElement("canvas")
    c.style.cssText = "position:fixed;left:0;top:0;width:200px;height:100px"
    document.body.appendChild(c)
    const press = port.createPress(c, {
      intro: 0,
      source: (ctx: CanvasRenderingContext2D, w: number, h: number) => ctx.fillRect(0, 0, w / 2, h),
      overlay: () => frames++,
    })
    press.start()
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const count = async () => {
      const a = frames
      await wait(300)
      return frames - a
    }
    const setHidden = (h: boolean) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h })
      document.dispatchEvent(new Event("visibilitychange"))
    }
    await wait(100)
    const running = await count()
    setHidden(true)
    const hidden = await count()
    setHidden(false)
    const back = await count()
    c.style.top = "5000px"
    await wait(150)
    const offscreen = await count()
    c.style.top = "0px"
    await wait(150)
    const onscreen = await count()
    press.destroy()
    const destroyed = await count()
    return { running, hidden, back, offscreen, onscreen, destroyed }
  })
  expect(r.running).toBeGreaterThan(5)
  expect(r.hidden).toBe(0)
  expect(r.back).toBeGreaterThan(5)
  expect(r.offscreen).toBe(0)
  expect(r.onscreen).toBeGreaterThan(5)
  expect(r.destroyed).toBe(0)
})
