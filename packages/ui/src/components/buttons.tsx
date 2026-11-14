import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react"
import s from "./buttons.module.css"

type BracketProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** paper: cream on the paper panel (hero). dark: outline on black (footer, app top bar). */
  tone?: "paper" | "dark"
  /** 62 / 54 / 38 px */
  size?: "lg" | "md" | "sm"
  /** the 48 px centre ticks (site only) */
  ticks?: boolean
}

export function BracketButton({ tone = "paper", size = "lg", ticks = size !== "sm", className, ...rest }: BracketProps) {
  const cls = [s.bracket, s[size], tone === "dark" && s.dark, ticks && s.ticks, className].filter(Boolean).join(" ")
  return <a className={cls} {...rest} />
}

export function BoxLink({ icon, className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { icon?: boolean }) {
  return <a className={[s.box, icon && s.icon, className].filter(Boolean).join(" ")} {...rest} />
}

export function BoxButton({ icon, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: boolean }) {
  return <button type="button" className={[s.box, icon && s.icon, className].filter(Boolean).join(" ")} {...rest} />
}
