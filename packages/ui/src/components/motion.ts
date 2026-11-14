"use client"
import { useSyncExternalStore } from "react"
import { readShot } from "../press/shot"

const noop = () => () => {}

/** Frozen time from ?shot&t=<s>, or null (always null on the server and during hydration). */
export function useShot(): number | null {
  return useSyncExternalStore(
    noop,
    () => readShot(window.location.search),
    () => null,
  )
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}
