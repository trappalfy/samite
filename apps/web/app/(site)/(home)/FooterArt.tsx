"use client"
import { useEffect, useRef } from "react"
import { cssFontFamily, Press } from "@samite/ui/press"
import { ImagePress } from "./ImagePress"

const FONT = (fs: number, family: string) => `italic 800 ${fs}px ${family}`
/** The prototype's word: the font size for a canvas of w × h, and the line the text sits on. */
const wordSize = (w: number, h: number) => Math.min(h * 0.95, w * 0.205)
const BASELINE = 0.9

/**
 * Where the word's canvas goes so the letters' ink is centred in the band: the canvas keeps the prototype's size
 * (the top 62% of the band) and its text, so the print is the reference's; only its top moves.
 */
function centreWord(box: HTMLElement) {
  const band = box.parentElement
  if (!band) return
  const H = band.clientHeight,
    w = box.clientWidth,
    h = box.clientHeight
  if (!H || !w || !h) return
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return
  ctx.font = FONT(wordSize(w, h), cssFontFamily("--ff-montserrat", "Montserrat"))
  const m = ctx.measureText("SAMITE")
  const inkMiddle = h * BASELINE - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
  box.style.top = `${Math.round(H / 2 - inkMiddle)}px`
}

/** Footer band: the clouds dithered in a dark ink, the SAMITE word cycling in dots on top (§11.10). */
export function FooterArt({ wordClass }: { wordClass?: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const family = cssFontFamily("--ff-montserrat", "Montserrat")
    let live = true
    const place = () => live && centreWord(el)
    // measured with the real face, once it has loaded
    void document.fonts.load(FONT(100, family)).then(place, place)
    const ro = new ResizeObserver(place)
    ro.observe(el.parentElement ?? el)
    return () => {
      live = false
      ro.disconnect()
    }
  }, [])

  return (
    <>
      <ImagePress
        src="/press/clouds.jpg"
        options={(cl) => ({
          cell: 5,
          shape: "bayer",
          schedule: "still",
          glow: 1,
          wide: 4,
          ink: "#3A3934",
          source(ctx, w, h) {
            const s = Math.max(w / cl.width, h / cl.height)
            ctx.drawImage(cl, (w - cl.width * s) / 2, 0, cl.width * s, cl.height * s)
            const f = ctx.createLinearGradient(0, h * 0.45, 0, h)
            f.addColorStop(0, "rgba(0,0,0,0)")
            f.addColorStop(1, "rgba(0,0,0,.9)")
            ctx.fillStyle = f
            ctx.fillRect(0, 0, w, h)
          },
        })}
      />
      <div ref={box} className={wordClass} data-footer-word>
        <Press
          options={() => {
            const family = cssFontFamily("--ff-montserrat", "Montserrat")
            return {
              cell: window.innerWidth < 600 ? 5 : 8,
              shape: "dot",
              schedule: "cycle",
              period: 7.2,
              fonts: [FONT(100, family)],
              source(ctx, w, h) {
                ctx.font = FONT(wordSize(w, h), family)
                ctx.textAlign = "center"
                ctx.fillText("SAMITE", w / 2, h * BASELINE)
              },
            }
          }}
        />
      </div>
    </>
  )
}
