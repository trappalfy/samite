import s from "../docs/docs.module.css"

// Terms and privacy (§10, §12), written in plain English and approved by the owner on Nov 13 (docs/DECISIONS.md).
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.docs} style={{ gridTemplateColumns: "1fr" }}>
      <main className={s.prose}>{children}</main>
    </div>
  )
}
