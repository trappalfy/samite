"use client"
// The job page's live parts (§9.3, §12): the chain's own status and hashes (read by the browser, whatever the API
// says), the poster's and the machine's actions, and the private delivery with its hash check.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { formatUsdc, shortAddress, splitReward } from "@samite/config/money"
import { deliveryHash, parseDelivery, parseRejectionReason, reasonHash } from "@samite/formats"
import { address } from "@solana/kit"
import { Ex } from "@samite/ui/components"
import { appClass as s, Button, Status } from "@samite/ui/app"
import { api } from "@/lib/wallet/api"
import { servedSpecHash, useChainJob, type ChainView } from "@/lib/wallet/chain"
import { requireWallet, useWallet } from "@/lib/wallet/store"
import { errorText } from "@/lib/wallet/errors"
import { signAndSend } from "@/lib/wallet/send"
import type { Expected } from "@/lib/wallet/verify"
import { ensureSession } from "@/lib/wallet/session"
import { duration, pendingTimeout, statusGlyph, type JobJson } from "@/lib/view"

type Ctx = { chain: ChainView; refresh(): void; job: JobJson }
const C = createContext<Ctx | null>(null)
const use = () => useContext(C)!

export function ChainJobProvider({ job, children }: { job: JobJson; children: ReactNode }) {
  const [n, setN] = useState(0)
  const chain = useChainJob(job.pda, n)
  return <C.Provider value={{ chain, job, refresh: () => setN((x) => x + 1) }}>{children}</C.Provider>
}

/** The status as the chain has it; the index's while the browser is still reading the chain. */
export function ChainStatusLabel() {
  const { chain, job } = use()
  const status = chain.state === "live" ? chain.status : job.status
  const g = statusGlyph(status, chain.state === "live" ? chain.worker : job.worker)
  return <Status kind={g.kind}>{g.label[0]!.toUpperCase() + g.label.slice(1)}</Status>
}

/** One line: what the browser checked against the chain, and anything that doesn't match this page. */
export function ChainCheck() {
  const { chain, job } = use()
  const [spec, setSpec] = useState<string | null>(null)
  useEffect(() => {
    servedSpecHash(job.no).then(setSpec, () => setSpec(null))
  }, [job.no])
  const pad = { padding: "14px 28px", margin: 0, borderBottom: "1px solid var(--line)" }
  if (chain.state === "loading")
    return (
      <p className={s.machineNote} style={pad}>
        Checking this job against the chain…
      </p>
    )
  if (chain.state === "error")
    return <p className={s.machineNote}>Couldn&apos;t reach the chain to check this page ({chain.message}).</p>
  const issues: string[] = []
  if (chain.state === "closed") {
    if (job.status === "open" || job.status === "claimed" || job.status === "delivered")
      issues.push("the job account is closed on-chain")
  } else {
    if (chain.status !== job.status) issues.push(`status is ${chain.status} on-chain`)
    if (chain.worker !== job.worker)
      issues.push(`the machine is ${chain.worker ? shortAddress(chain.worker) : "none"} on-chain`)
    if (chain.deliveryHash !== job.delivery_hash) issues.push("the delivery hash differs on-chain")
    if (chain.specHash !== job.spec_hash) issues.push("the spec hash differs on-chain")
    if (chain.reward.toString() !== job.reward) issues.push("the reward differs on-chain")
  }
  const specOk = spec !== null && spec === (chain.state === "live" ? chain.specHash : job.spec_hash)
  return (
    <p
      className={s.machineNote}
      style={pad}
      role={issues.length ? "alert" : undefined}
      data-chain-check={issues.length ? "mismatch" : "ok"}
    >
      {issues.length
        ? `The chain disagrees with this page: ${issues.join("; ")}. The status above is the chain's.`
        : chain.state === "closed"
          ? "Checked on-chain: the job account is closed (paid, refunded or cancelled)."
          : "Checked on-chain: status, machine, reward and hashes match."}{" "}
      {spec !== null &&
        (specOk
          ? `Spec sha256 ${spec.slice(0, 4)}…${spec.slice(-4)} ✓ matches on-chain hash.`
          : "The spec served here doesn't hash to the on-chain value.")}
    </p>
  )
}

function useAct() {
  const { refresh } = use()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await ensureSession(requireWallet())
      await fn()
      refresh()
      router.refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

type TxReply = { transaction: string; summary: { usdc: Record<string, string>; lines: string[] } }

/** Poster: accept, reject (with a public reason), cancel. Machine: drop the job. Anyone else: nothing (§11.12). */
export function JobActions() {
  const { chain, job } = use()
  const { connected } = useWallet()
  const { busy, error, run } = useAct()
  const dialog = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState("")
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  if (chain.state !== "live" || !connected) return null
  const me = connected.address
  const { toMachine } = splitReward(chain.reward, job.fee_bps)
  const t = pendingTimeout(
    {
      status: chain.status,
      deadline: chain.deadline,
      review_window: chain.reviewWindow,
      delivered_at: chain.deliveredAt,
    },
    now,
  )

  // the amount on the button is the amount in the transaction, or nothing is signed (Review Focus 3)
  // and the transaction is exactly the instruction this page asked for, for this job and wallet (verify.ts)
  const pda = address(job.pda)
  const worker = chain.worker ? address(chain.worker) : null
  const send = async (
    action: Expected["action"],
    body: Record<string, unknown>,
    expected: Expected,
    expect?: Record<string, string>,
  ) => {
    const r = await api<TxReply>(`/tx/${action}`, { body })
    for (const [k, v] of Object.entries(expect ?? {}))
      if (r.summary.usdc[k] !== v)
        throw new Error(`The transaction moves ${r.summary.usdc[k]} (${k}), not ${v} as shown; it was not signed.`)
    await signAndSend(requireWallet(), r.transaction, expected)
  }
  const n = [...reason.trim()].length

  let buttons: ReactNode = null
  if (me === job.poster && chain.status === "delivered")
    buttons = (
      <>
        <Button
          size="big"
          disabled={busy}
          onClick={() =>
            run(() =>
              send(
                "accept",
                { job: job.no },
                { action: "accept", job: pda, machine: worker! },
                { to_machine: toMachine.toString() },
              ),
            )
          }
        >
          Accept and pay {formatUsdc(toMachine, { decimals: "exact" })} USDC
        </Button>
        <Button size="big" variant="ghost" disabled={busy} onClick={() => dialog.current?.showModal()}>
          Reject with a reason
        </Button>
      </>
    )
  else if (me === job.poster && chain.status === "open")
    buttons = (
      <Button
        size="big"
        variant="ghost"
        disabled={busy}
        onClick={() =>
          run(() =>
            send("cancel", { job: job.no }, { action: "cancel", job: pda }, { refund: chain.reward.toString() }),
          )
        }
      >
        Cancel and take back {formatUsdc(chain.reward)} USDC
      </Button>
    )
  else if (me === chain.worker && chain.status === "claimed")
    buttons = (
      <>
        <Button
          size="big"
          variant="ghost"
          disabled={busy}
          onClick={() => run(() => send("unclaim", { job: job.no }, { action: "unclaim", job: pda }))}
        >
          Drop this job
        </Button>
        <span className={s.count}>
          Deliver with the SDK, the MCP server or the HTTP API. If you drop it, you can&apos;t claim it again.
        </span>
      </>
    )
  if (!buttons) return null
  return (
    <>
      <div className={s.actions}>
        {buttons}
        {t && (
          <span className={s.count}>
            {t.kind === "auto-release" ? "Auto-release" : "Refund to the poster"}{" "}
            {t.left > 0 ? (
              <>
                in <b>{duration(t.left)}</b>
              </>
            ) : (
              <b>now</b>
            )}
          </span>
        )}
        {error && (
          <div style={{ flexBasis: "100%" }} role="alert" className={s.invalid}>
            {error}
          </div>
        )}
      </div>
      <dialog ref={dialog} className={s.dialog} aria-labelledby="reject-h" onClose={() => setReason("")}>
        <form
          method="dialog"
          onSubmit={(e) => {
            if (n < 10 || n > 1000) return e.preventDefault()
            const text = reason
            void run(async () => {
              const parsed = parseRejectionReason(text)
              if (!parsed.ok) throw new Error("A reason is 10 to 1,000 characters.")
              const local = reasonHash(parsed.reason).hex
              const { reason_hash } = await api<{ reason_hash: string }>(`/jobs/${job.no}/rejection`, {
                body: { reason: text },
              })
              if (reason_hash !== local) throw new Error("The server stored a different reason than you wrote.")
              await send(
                "reject",
                { job: job.no, reason_hash },
                { action: "reject", job: pda, machine: worker!, reasonHash: local },
              )
            })
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
              minLength={10}
              maxLength={1000}
              required
              aria-describedby="reason-n"
            />
            <div id="reason-n" className={s.machineNote}>
              {n} / 1000 characters, at least 10
            </div>
          </div>
          <div className={s.dialogActions}>
            <Button type="submit" disabled={n < 10}>
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

type DeliveryReply = {
  deliveries: {
    attempt: number
    delivery_hash: string
    manifest: unknown
    files: { name: string; url: string | null }[]
    files_deleted?: boolean
    /** Deleted 90 days after the job closed: no content left, only the hash. */
    deleted?: boolean
  }[]
}

/** The delivery, for the poster and the machine only: manifest, files, and the hash re-computed here. */
export function DeliveryView() {
  const { chain, job } = use()
  const { connected } = useWallet()
  const { busy, error, run } = useAct()
  const [d, setD] = useState<DeliveryReply | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const me = connected?.address
  if (!job.delivery_hash) return <p className={s.machineNote}>No delivery yet.</p>
  if (!me || (me !== job.poster && me !== job.worker))
    return (
      <p className={s.machineNote}>
        Deliveries are private to the poster and the machine. The hash is on-chain for anyone to check.
      </p>
    )
  if (!d)
    return (
      <div className={s.actions}>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => run(async () => setD(await api<DeliveryReply>(`/jobs/${job.no}/delivery`)))}
        >
          Show the delivery
        </Button>
        {error && (
          <span role="alert" className={s.invalid}>
            {error}
          </span>
        )}
      </div>
    )
  const latest = d.deliveries[0]
  if (!latest) return <p className={s.machineNote}>No delivery yet.</p>
  if (latest.deleted)
    return (
      <div className={s.deliv}>
        <div className={s.h}>
          <span>Delivery {latest.attempt}</span>
          <span data-delivery-check="deleted">
            sha256 {latest.delivery_hash.slice(0, 4)}…{latest.delivery_hash.slice(-4)} on-chain
          </span>
        </div>
        <p style={{ padding: "14px 16px" }}>
          This delivery was deleted 90 days after the job closed: its files, text, link and note. Its hash stays
          on-chain.
        </p>
      </div>
    )
  const parsed = parseDelivery(latest.manifest)
  const rehash = parsed.ok ? deliveryHash(parsed.delivery).hex : null
  const onChain = chain.state === "live" ? chain.deliveryHash : job.delivery_hash
  const ok = rehash !== null && rehash === onChain
  const m = parsed.ok ? parsed.delivery : null
  const first = latest.files[0]
  return (
    <div className={s.deliv}>
      <div className={s.h}>
        <span>
          Delivery {latest.attempt}
          {m?.kind === "file"
            ? ` · ${m.files.map((f) => `${f.name} · ${f.bytes.toLocaleString("en-US")} bytes`).join(", ")}`
            : ""}
        </span>
        <span data-delivery-check={ok ? "ok" : "mismatch"}>
          sha256 {rehash ? `${rehash.slice(0, 4)}…${rehash.slice(-4)}` : "?"}{" "}
          {ok ? "✓ matches on-chain hash" : "✗ doesn't match the on-chain hash"}
        </span>
      </div>
      {m?.kind === "text" && <pre tabIndex={0}>{m.text}</pre>}
      <div
        style={{
          padding: "14px 16px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 10,
          justifyItems: "start",
        }}
      >
        {m?.kind === "url" && (
          <p>
            <a href={m.url} rel="nofollow noopener ugc noreferrer" target="_blank">
              {m.url}
            </a>
          </p>
        )}
        {latest.files_deleted ? (
          <p>The files were deleted 90 days after the job closed. Their hashes stay on-chain.</p>
        ) : (
          latest.files.map(
            (f) =>
              f.url && (
                <p key={f.name}>
                  <a href={f.url} download={f.name}>
                    Download {f.name}
                  </a>
                </p>
              ),
          )
        )}
        {first?.url && /\.(csv|tsv|txt|json|md)$/i.test(first.name) && preview === null && (
          <Button
            variant="ghost"
            onClick={async () => {
              const text = new TextDecoder().decode((await (await fetch(first.url!)).arrayBuffer()).slice(0, 4096))
              setPreview(text.split("\n").slice(0, 5).join("\n") + "\n…")
            }}
          >
            Preview the first rows
          </Button>
        )}
        {preview !== null && (
          <pre tabIndex={0} aria-label="First rows of the delivered file">
            {preview}
          </pre>
        )}
        {m?.note && <p className={s.machineNote}>Machine&apos;s note: &quot;{m.note}&quot;</p>}
        <Ex>Downloads are attachments; deliveries are deleted 90 days after the job closes.</Ex>
      </div>
    </div>
  )
}
