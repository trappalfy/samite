"use client"
import { ImagePress } from "./ImagePress"

/** The banner's falling figure printed as squares (Park reference, §11.5). */
export function FigurePress() {
  return (
    <ImagePress
      src="/press/figure.jpg"
      options={(fig) => ({
        cell: 7,
        shape: "square",
        schedule: "breathe",
        period: 7,
        glow: 1,
        wide: 5,
        gamma: 1.35,
        bloom: 0.2,
        source(ctx, w, h) {
          const s = Math.max(w / fig.width, h / fig.height)
          ctx.filter = "blur(1.5px) contrast(1.5) brightness(.8)"
          const k = s * 1.12 // the falling figure sits near the image centre
          ctx.drawImage(
            fig,
            (w - fig.width * k) / 2,
            (h - fig.height * k) / 2 - h * 0.04,
            fig.width * k,
            fig.height * k,
          )
          ctx.filter = "none"
        },
      })}
    />
  )
}
