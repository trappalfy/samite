"use client"
import { useEffect, useState } from "react"
import { Press, type PressOptions } from "@samite/ui/press"

/**
 * A press whose source is a photo. The image loads after the page has loaded (it never competes with the
 * first paint) and the press is created once it is decoded.
 */
export function ImagePress({ src, options }: { src: string; options: (img: HTMLImageElement) => PressOptions }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      const i = new Image()
      i.src = src
      i.decode().then(
        () => alive && setImg(i),
        () => undefined,
      )
    }
    if (document.readyState === "complete") load()
    else window.addEventListener("load", load, { once: true })
    return () => {
      alive = false
      window.removeEventListener("load", load)
    }
  }, [src])
  return img ? <Press options={() => options(img)} /> : <canvas aria-hidden="true" />
}
