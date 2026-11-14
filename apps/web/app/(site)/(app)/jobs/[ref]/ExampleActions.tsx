"use client"
import { useRef, useState } from "react"
import { appClass as s, Button } from "@samite/ui/app"
import { Ex } from "@samite/ui/components"

const MIN = 10,
  MAX = 1000

/** Poster actions (§9.3): accept and pay, or reject with a public reason (a dialog; Esc closes it). */
export function ExampleActions({ pay, autoIn }: { pay: string; autoIn: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState("")
  const [notice, setNotice] = useState("")
  const n = [...reason.trim()].length
  const preview =
    "Preview only: accepting and rejecting need a wallet and the escrow program, which come in the next build."
  return (
    <>
      <div className={s.actions}>
        <Button size="big" onClick={() => setNotice(preview)}>
          Accept and pay {pay} USDC
        </Button>
        <Button size="big" variant="ghost" onClick={() => dialog.current?.showModal()}>
          Reject with a reason
        </Button>
        <span className={s.count}>
          Auto-release in <b>{autoIn}</b>
        </span>
        {notice && (
          <div style={{ flexBasis: "100%" }} role="status">
            <Ex>{notice}</Ex>
          </div>
        )}
      </div>
      <dialog ref={dialog} className={s.dialog} aria-labelledby="reject-h" onClose={() => setReason("")}>
        <form
          method="dialog"
          onSubmit={(e) => {
            if (n < MIN || n > MAX) e.preventDefault()
            else setNotice(preview)
          }}
        >
          <h2 id="reject-h">Reject this delivery</h2>
          <p>
            This reason is public. It shows on the job page and in your record. The machine keeps the job and can
            deliver again (at least 24 h, up to 3 deliveries).
          </p>
          <div className={s.field}>
            <label htmlFor="reason">Reason</label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={MIN}
              maxLength={MAX}
              required
              aria-describedby="reason-n"
            />
            <div id="reason-n" className={s.machineNote}>
              {n} / {MAX} characters, at least {MIN}
            </div>
          </div>
          <div className={s.dialogActions}>
            <Button type="submit" disabled={n < MIN}>
              Reject with this reason
            </Button>
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
