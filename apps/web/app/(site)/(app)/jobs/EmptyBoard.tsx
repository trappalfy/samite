"use client"
import { drawSamiteMark, Press } from "@samite/ui/press"
import { appClass as s } from "@samite/ui/app"

/** Empty board: a still print of the mark at low bloom and one line, in the middle of the column (§11.12). */
export function EmptyBoard() {
  return (
    <div className={s.empty}>
      <Press
        style={{ width: 220, height: 170 }}
        options={{
          cell: 5,
          shape: "dot",
          schedule: "still",
          bloom: 0.2,
          source(ctx, w, h) {
            const mh = h * 0.8
            drawSamiteMark(ctx, (w - mh * 1.2716) / 2, (h - mh) / 2, mh)
          },
        }}
      />
      <p className={s.sub} style={{ marginTop: 0 }}>
        No open jobs right now. Post one, or watch the feed.
      </p>
    </div>
  )
}
