import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from "react"
import { Ex, Glyph, type GlyphKind } from "../marks"
import s from "./app.module.css"

export const appClass = s
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ")

type Variant = { variant?: "primary" | "ghost"; size?: "md" | "big" }

/** Primary (solid cream) or ghost button, 38 or 56 px (§11.7). */
export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & Variant) {
  return <button type="button" className={cx(s.btn, variant === "ghost" && s.ghost, size === "big" && s.big, className)} {...rest} />
}
export function ButtonLink({ variant = "primary", size = "md", className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & Variant) {
  return <a className={cx(s.btn, variant === "ghost" && s.ghost, size === "big" && s.big, className)} {...rest} />
}

/** Glyph + mono uppercase label: status is never the glyph alone (§11.13). */
export function Status({ kind, children, light }: { kind: GlyphKind; children: ReactNode; light?: boolean }) {
  return (
    <span className={cx(s.st, light && s.stLight)}>
      <Glyph kind={kind} />
      {children}
    </span>
  )
}

export function Panel({ title, example, children, className }: { title: string; example?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={cx(s.panel, className)} aria-label={title}>
      <h2>
        {title} {example && <Ex>(example)</Ex>}
      </h2>
      {children}
    </section>
  )
}

export function KV({ items, className, style }: { items: [ReactNode, ReactNode][]; className?: string; style?: CSSProperties }) {
  return (
    <dl className={cx(s.kv, className)} style={style}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Feed({ items }: { items: { kind: GlyphKind; text: ReactNode; at: string; label?: string }[] }) {
  return (
    <ul className={s.feed}>
      {items.map((it, i) => (
        <li key={i}>
          <Glyph kind={it.kind} />
          <span>{it.text}</span>
          <span className={s.t}>{it.at}</span>
        </li>
      ))}
    </ul>
  )
}

export type TimelineStep = { n: string; kind: GlyphKind; label: string; when: string; tx?: string; txHref?: string; state: "done" | "now" | "todo" }

/** The job's 4-step timeline with a 3 px bar per step (cream when done, half for the current step). */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className={s.timeline}>
      {steps.map((st) => (
        <li key={st.n} className={cx(s.ts, st.state === "done" && s.done, st.state === "now" && s.now)} aria-current={st.state === "now" ? "step" : undefined}>
          <i className={s.bar} aria-hidden="true" />
          <div className={cx(s.mono, s.dim)}>{st.n}</div>
          <Status kind={st.kind}>{st.label}</Status>
          <div className={s.when}>{st.when}</div>
          {st.tx && (
            <div className={s.tx}>
              {/* no link until there is an explorer page to go to (§11.10: hidden, not dead) */}
              {st.txHref ? <a href={st.txHref}>{st.tx} ↗</a> : st.tx}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className={s.tag}>{children}</span>
}

export function Amount({ value, unit = "USDC" }: { value: string; unit?: string }) {
  return (
    <span className={s.amt}>
      {value}
      <small>{unit}</small>
    </span>
  )
}
