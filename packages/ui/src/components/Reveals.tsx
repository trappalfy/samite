"use client"
import { useEffect } from "react"
import { readShot } from "../press/shot"

/**
 * Section entrances (§11.8): elements with [data-reveal] rise 12 px and fade in once, staggered 80 ms.
 * Shot mode and reduced motion show them at once (the CSS handles reduced motion).
 */
export function Reveals() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")]
    if (readShot(window.location.search) !== null || typeof IntersectionObserver !== "function") {
      els.forEach((e) => e.setAttribute("data-in", ""))
      return
    }
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return
          e.target.setAttribute("data-in", "")
          io.unobserve(e.target)
        }),
      { threshold: 0.2 },
    )
    els.forEach((e, i) => {
      e.style.transitionDelay = `${(i % 5) * 80}ms`
      io.observe(e)
    })
    return () => io.disconnect()
  }, [])
  return null
}
