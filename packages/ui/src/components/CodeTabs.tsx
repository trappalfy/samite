"use client"
import { useId, useState, type ReactNode } from "react"
import s from "./site.module.css"

export type CodeTab = { label: string; code: ReactNode }

/** Tabbed code block (MCP / SDK / HTTP). Comments inside `code` use <span className={commentClass}>. */
export function CodeTabs({ tabs, className }: { tabs: CodeTab[]; className?: string }) {
  const [on, setOn] = useState(0)
  const id = useId()
  return (
    <div className={className}>
      <div className={s.tabs} role="tablist" aria-label="Ways to connect">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === on}
            aria-controls={`${id}-panel`}
            tabIndex={i === on ? 0 : -1}
            className={i === on ? s.tabOn : undefined}
            onClick={() => setOn(i)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
              const n = (on + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length
              setOn(n)
              document.getElementById(`${id}-tab-${n}`)?.focus()
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <pre className={s.pre} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${on}`} tabIndex={0}>
        {tabs[on]!.code}
      </pre>
    </div>
  )
}

export const commentClass = s.c
