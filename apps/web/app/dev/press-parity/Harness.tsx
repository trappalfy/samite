"use client"
import { useEffect } from "react"
import { createPress, cssFontFamily, drawSamiteMark } from "@samite/ui/press"

export function Harness() {
  useEffect(() => {
    Object.assign(window, { __port: { createPress, drawSamiteMark, cssFontFamily } })
    document.body.dataset.ready = ""
  }, [])
  return <p>press parity harness</p>
}
