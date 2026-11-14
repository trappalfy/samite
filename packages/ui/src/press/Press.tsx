"use client"
import { useEffect, useRef, type CSSProperties } from "react"
import { createPress, type PressHandle, type PressOptions } from "./engine"
import { readShot } from "./shot"

type Props = {
  /** Read once at mount (a factory runs in the browser only). To redraw, call layout() on the handle from onReady. */
  options: Omit<PressOptions, "frozenAt"> | (() => Omit<PressOptions, "frozenAt">)
  className?: string
  style?: CSSProperties
  onReady?: (press: PressHandle) => void
}

/** A canvas printed by the press. Decorative: always aria-hidden; give it a text equivalent nearby. */
export function Press({ options, className, style, onReady }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const frozenAt = readShot(window.location.search)
    const o = typeof options === "function" ? options() : options
    const press = createPress(canvas, { ...o, frozenAt })
    if (frozenAt === null) press.start()
    else press.seek(frozenAt)
    onReady?.(press)
    if (process.env.NODE_ENV !== "production" || frozenAt !== null) {
      ;(window as unknown as { __presses?: PressHandle[] }).__presses ??= []
      ;(window as unknown as { __presses: PressHandle[] }).__presses.push(press)
    }
    return () => press.destroy()
    // options and onReady are read once at mount by design
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <canvas ref={ref} aria-hidden="true" className={className} style={style} />
}
