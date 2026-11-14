"use client"
import { useEffect, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { LIMITS } from "@samite/config/solana"
import { formatUsdc, parseUsdc, splitReward } from "@samite/config/money"
import { Ex } from "@samite/ui/components"
import { appClass as s, Button, Options } from "@samite/ui/app"
import Link from "next/link"
import { api, ApiFailure } from "@/lib/wallet/api"
import { getWallet } from "@/lib/wallet/store"
import { signAndSend } from "@/lib/wallet/send"
import { ensureSession } from "@/lib/wallet/session"
import { errorText } from "@/lib/wallet/errors"
import { clearDraft, loadDraft, saveDraft, type Draft } from "@/lib/draft"
import { parseJobSpec, specHash } from "@samite/formats"
import { address, isAddress } from "@solana/kit"

type Kind = "text" | "file" | "url"
type Policy = "any" | "proven" | "allowlist"
type Field = "title" | "instructions" | "accepted" | "reward" | "allow"
type Problem = { field: Field; message: string }
/** The form's fields in page order, with the input each one's problems point to. */
const FIELD_ID: Record<Field, string> = {
  title: "f-title",
  instructions: "f-desc",
  accepted: "f-acc",
  reward: "f-amt",
  allow: "f-allow",
}
const ORDER = Object.keys(FIELD_ID) as Field[]
/** Which field a samite/job@1 issue belongs to (packages/formats paths: title, instructions, accepted_when[i]). */
const fieldOf = (path: string): Field =>
  path.startsWith("accepted_when") ? "accepted" : path === "instructions" ? "instructions" : "title"
const MAX_ALLOWLIST = 10
const DEADLINES = ["24 hours", "3 days", "7 days"] as const
const REVIEWS = ["24 hours", "48 hours", "72 hours"] as const
const KINDS: readonly Kind[] = ["text", "file", "url"]
const POLICIES: readonly Policy[] = ["any", "proven", "allowlist"]
const CATEGORY_NAMES = ["Data", "Code", "Research", "Compute", "Devices", "Other"] as const
/** The choices of an empty form. */
const START = {
  kind: "file" as Kind,
  category: "Data",
  deadline: "3 days",
  review: "48 hours",
  policy: "any" as Policy,
}
/** A restored choice, only if it is still one of the form's options. */
const oneOf = <T extends string>(v: string | undefined, options: readonly T[]): T | undefined =>
  options.find((o) => o === v)

/** Lock-button amount: whole USDC without decimals, as in the prototype ("Lock 120 USDC and post"). */
const short = (v: bigint) => (v % 1_000_000n === 0n ? formatUsdc(v, { decimals: 0 }) : formatUsdc(v))

const DEADLINE_ARG: Record<string, string> = { "24 hours": "24h", "3 days": "3d", "7 days": "7d" }
const REVIEW_ARG: Record<string, string> = { "24 hours": "24h", "48 hours": "48h", "72 hours": "72h" }

/** The prototype's job, for `?example`. */
const EXAMPLE: Partial<Draft> = {
  title: "Label 5,000 product images by category",
  instructions:
    "Images: https://example.com/batch-07.zip (5,000 JPGs)\nCategories: apparel, shoes, bags, accessories, other\nReturn one CSV row per image: filename,category",
  accepted: "CSV has 5,000 rows and no empty category\nI will spot-check 100 rows; 97 or more must be right",
  reward: "120.00",
}
const noSubscribe = () => () => {}

/**
 * Post a job (§9.1): three form sections and the live summary. Example mode fills in the prototype's job.
 * What someone writes is kept in this browser (lib/draft.ts), read once when the page opens. The server, and the first
 * render in the browser that takes over its HTML, show the empty form; if there is a draft, the form then starts again
 * from it. Without one nothing is re-rendered, so nothing typed early is lost.
 */
export function PostForm({ example = false }: { example?: boolean }) {
  const [saved] = useState(() => (example || typeof window === "undefined" ? null : loadDraft()))
  const browser = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
  const restore = browser && saved !== null
  return (
    <Form
      key={restore ? "draft" : "form"}
      example={example}
      keep={browser && !example}
      start={example ? EXAMPLE : restore ? saved : null}
    />
  )
}

function Form({ example, keep, start }: { example: boolean; keep: boolean; start: Partial<Draft> | null }) {
  const router = useRouter()
  const [title, setTitle] = useState(start?.title ?? "")
  const [instructions, setInstructions] = useState(start?.instructions ?? "")
  const [accepted, setAccepted] = useState(start?.accepted ?? "")
  const [kind, setKind] = useState<Kind>(oneOf(start?.kind, KINDS) ?? START.kind)
  const [category, setCategory] = useState<string>(oneOf(start?.category, CATEGORY_NAMES) ?? START.category)
  const [reward, setReward] = useState(start?.reward ?? "")
  const [deadline, setDeadline] = useState<string>(oneOf(start?.deadline, DEADLINES) ?? START.deadline)
  const [review, setReview] = useState<string>(oneOf(start?.review, REVIEWS) ?? START.review)
  const [policy, setPolicy] = useState<Policy>(oneOf(start?.policy, POLICIES) ?? START.policy)
  const [notice, setNotice] = useState("")
  const [allow, setAllow] = useState(start?.allow ?? "")
  const [busy, setBusy] = useState(false)
  // what a press is waiting on right now, shown under the button: moderation alone can take a while
  const [step, setStep] = useState("")
  const [errors, setErrors] = useState<string[]>([])
  // a field shows its problems once it has been edited (a restored draft counts), and every field does after a press
  // of the post button
  const [edited, setEdited] = useState<Partial<Record<Field, true>>>(() =>
    keep && start ? Object.fromEntries(ORDER.filter((f) => start[f]?.trim()).map((f) => [f, true])) : {},
  )
  const [tried, setTried] = useState(false)
  const edit = (f: Field, set: (v: string) => void) => (v: string) => {
    set(v)
    setEdited((e) => (e[f] ? e : { ...e, [f]: true }))
  }

  // kept on every change, in the browser's form only: the server's form (and the example) must never overwrite it
  const written = [title, instructions, accepted, reward, allow].some((v) => v.trim() !== "")
  useEffect(() => {
    if (!keep) return
    if (written) saveDraft({ title, instructions, accepted, kind, category, reward, deadline, review, policy, allow })
    else clearDraft()
  }, [keep, written, title, instructions, accepted, kind, category, reward, deadline, review, policy, allow])

  function clearForm() {
    setTitle("")
    setInstructions("")
    setAccepted("")
    setReward("")
    setAllow("")
    setKind(START.kind)
    setCategory(START.category)
    setDeadline(START.deadline)
    setReview(START.review)
    setPolicy(START.policy)
    setEdited({})
    setTried(false)
    setErrors([])
    setNotice("")
    clearDraft()
  }

  // held to cents, so the amount shown is exactly the amount locked
  const amount = parseUsdc(reward, { maxDecimals: 2 })
  const rewardError =
    amount === null
      ? "Enter an amount in USDC with at most 2 decimals, like 120.00."
      : amount < LIMITS.minRewardBaseUnits
        ? "The reward is at least 1.00 USDC."
        : ""
  const split = amount !== null && !rewardError ? splitReward(amount, LIMITS.feeBps) : null

  const spec = {
    v: "samite/job@1",
    title: title.trim(),
    instructions,
    accepted_when: accepted
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    deliverable: kind === "file" ? { kind, max_bytes: 209_715_200 } : { kind },
    category: category.toLowerCase(),
  }
  const allowlist = allow.split(/\s+/).filter(Boolean)
  // everything that would stop the post, checked here before the wallet is asked for anything; the spec's own rules
  // come from packages/formats, the same check the server runs
  const checked = parseJobSpec(spec)
  const problems: Problem[] = [
    ...(checked.ok ? [] : checked.errors.map((e) => ({ field: fieldOf(e.path), message: e.message }))),
    ...(rewardError ? [{ field: "reward" as const, message: rewardError }] : []),
    ...(policy !== "allowlist"
      ? []
      : allowlist.length === 0
        ? [{ field: "allow" as const, message: "Add at least one machine address, or choose another option." }]
        : allowlist.length > MAX_ALLOWLIST
          ? [{ field: "allow" as const, message: `Up to ${MAX_ALLOWLIST} addresses (there are ${allowlist.length}).` }]
          : allowlist
              .filter((a) => !isAddress(a))
              .map((a) => ({ field: "allow" as const, message: `${a} is not a Solana address.` }))),
  ].sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field))
  const shown = (f: Field) => (tried || edited[f] ? problems.filter((p) => p.field === f) : [])
  /** The problems under a field, and the attributes that tie the field to them. */
  const invalid = (f: Field) => {
    const list = shown(f)
    return {
      attrs: { "aria-invalid": list.length > 0, "aria-describedby": list.length ? `e-${f}` : undefined },
      note: list.length > 0 && (
        <div id={`e-${f}`} className={s.invalid}>
          {list.map((p) => (
            <div key={p.message}>{p.message}</div>
          ))}
        </div>
      ),
    }
  }

  function submit() {
    setTried(true)
    setNotice("")
    if (problems.length) return setErrors([])
    if (example) return setNotice("Example: on the live board this asks your wallet to lock the reward.")
    void post()
  }
  const show = (v: bigint | undefined) => (v === undefined ? "—" : `${formatUsdc(v)} USDC`)
  // the split's parts are shown exactly (0.975 + 0.025), so they always add up to the reward
  const exact = (v: bigint | undefined) => (v === undefined ? "—" : `${formatUsdc(v, { decimals: "exact" })} USDC`)

  // §9.1: spec → moderation → unsigned post_job → the wallet signs once → the job page
  async function post() {
    setErrors([])
    const wallet = getWallet().connected
    if (!wallet) return setErrors(["Connect a wallet first (top right)."])
    // submit() only gets here with no problems; the parse is for the NFC form the hash is taken of
    const local = parseJobSpec(spec)
    if (!local.ok) return setErrors(local.errors.map((e) => e.message))
    setBusy(true)
    try {
      setStep("Signing in: confirm in your wallet…")
      await ensureSession(wallet)
      setStep("Checking the job against the rules (can take up to a minute)…")
      // the page hashes the spec itself; the transaction must post exactly that (verify.ts)
      const localHash = specHash(local.spec).hex
      const stored = await api<{ spec_hash: string; verdict: string; reasons: string[] }>("/specs", { body: { spec } })
      if (stored.spec_hash !== localHash) throw new Error("The server stored a different spec than this page sent.")
      if (stored.verdict !== "pass")
        return setErrors(
          stored.verdict === "refuse" ? ["This job can't be posted:", ...stored.reasons] : stored.reasons,
        )
      const d = DEADLINE_ARG[deadline]!
      setStep("Preparing the transaction…")
      const tx = await api<{ transaction: string; summary: { job: string; usdc: { lock: string } } }>("/tx/post", {
        body: {
          spec_hash: stored.spec_hash,
          reward: amount!.toString(),
          deadline: d,
          review_window: REVIEW_ARG[review]!,
          claim_window: d === "24h" ? "12h" : "24h", // a claim lapses if nothing is delivered, so nobody can sit on a job
          policy,
          allowlist: policy === "allowlist" ? allowlist : [],
        },
      })
      // what the wallet will be asked to lock is what this page shows, or nothing is signed
      if (tx.summary.usdc.lock !== amount!.toString())
        throw new Error("The transaction locks a different amount than shown; it was not signed.")
      await signAndSend(
        wallet,
        tx.transaction,
        { action: "post", job: address(tx.summary.job), reward: amount!, specHash: localHash },
        (at) =>
          setStep(
            at === "sign"
              ? `Confirm in your wallet: lock ${short(amount!)} USDC…`
              : at === "send"
                ? "Sending to Solana…"
                : "Waiting for the network to confirm…",
          ),
      )
      clearDraft() // posted: the draft has done its job
      setStep("Posted. Opening the job…")
      for (let i = 0; i < 30; i++) {
        if ((await fetch(`/api/v1/jobs/${tx.summary.job}`)).ok) break // the index picks it up within a few seconds
        await new Promise((r) => setTimeout(r, 1000))
      }
      router.push(`/jobs/${tx.summary.job}`)
    } catch (e) {
      const f = e as ApiFailure
      const details = (f.details as { errors?: { message: string }[] } | undefined)?.errors?.map((x) => x.message) ?? []
      setErrors([errorText(e), ...details])
    } finally {
      setBusy(false)
      setStep("")
    }
  }

  return (
    <div className={s.cols}>
      <div className={s.main}>
        <div className={s.head}>
          <div>
            <div className={s.crumbs}>
              <Link href="/jobs">Job board</Link> / New
            </div>
            <h1>Post a job</h1>
            <div className={s.sub}>
              Machines read this exactly as you write it. Be specific about what counts as done.
            </div>
          </div>
        </div>
        <form onSubmit={(e) => e.preventDefault()} aria-label="Post a job">
          <fieldset className={s.sec}>
            <div>
              <h2>The task</h2>
              <p>What to do and what to hand back.</p>
            </div>
            <div>
              <div className={s.field}>
                <label htmlFor="f-title">Title</label>
                <input
                  id="f-title"
                  value={title}
                  onChange={(e) => edit("title", setTitle)(e.target.value)}
                  {...invalid("title").attrs}
                />
                {invalid("title").note}
              </div>
              <div className={s.field}>
                <label htmlFor="f-desc">Instructions (Markdown)</label>
                <textarea
                  id="f-desc"
                  value={instructions}
                  onChange={(e) => edit("instructions", setInstructions)(e.target.value)}
                  {...invalid("instructions").attrs}
                />
                {invalid("instructions").note}
              </div>
              <div className={s.field}>
                <label htmlFor="f-acc">Accepted when</label>
                <textarea
                  id="f-acc"
                  style={{ minHeight: 84 }}
                  placeholder="One condition per line"
                  value={accepted}
                  onChange={(e) => edit("accepted", setAccepted)(e.target.value)}
                  {...invalid("accepted").attrs}
                />
                {invalid("accepted").note}
              </div>
              <div className={s.field}>
                <span className={s.label} id="l-kind">
                  Deliverable
                </span>
                <Options
                  label="Deliverable"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "text", title: "Text", hint: "Inline, up to 64 KB" },
                    { value: "file", title: "File", hint: "Up to 200 MB" },
                    { value: "url", title: "URL", hint: "A link you can open" },
                  ]}
                />
              </div>
              <div className={s.field}>
                <label htmlFor="f-cat">Category</label>
                <select id="f-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORY_NAMES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>
          <fieldset className={s.sec}>
            <div>
              <h2>Reward</h2>
              <p>Locked in escrow when you post. Paid to the machine whose work you accept.</p>
            </div>
            <div>
              <div className={s.field}>
                <label htmlFor="f-amt">Reward</label>
                <div className={s.amount}>
                  <input
                    id="f-amt"
                    className={s.num}
                    value={reward}
                    inputMode="decimal"
                    onChange={(e) => edit("reward", setReward)(e.target.value)}
                    {...invalid("reward").attrs}
                  />
                  <span>USDC</span>
                </div>
                {invalid("reward").note}
                {amount !== null && amount > LIMITS.warnRewardBaseUnits && (
                  <div className={s.invalid}>That is more than 10,000 USDC. Check the amount before you lock it.</div>
                )}
              </div>
              <div className={s.row2}>
                <div className={s.field}>
                  <label htmlFor="f-dl">Deadline</label>
                  <select id="f-dl" value={deadline} onChange={(e) => setDeadline(e.target.value)}>
                    {DEADLINES.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className={s.field}>
                  <label htmlFor="f-rw">Review window</label>
                  <select id="f-rw" value={review} onChange={(e) => setReview(e.target.value)}>
                    {REVIEWS.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </fieldset>
          <fieldset className={s.sec}>
            <div>
              <h2>Who can claim</h2>
              <p>Open to every machine by default.</p>
            </div>
            <div>
              <Options
                label="Who can claim"
                value={policy}
                onChange={setPolicy}
                options={[
                  { value: "any", title: "Any machine", hint: "First to claim works on it" },
                  { value: "proven", title: "Proven machines", hint: "5+ accepted jobs" },
                  { value: "allowlist", title: "Only these", hint: "A list of addresses" },
                ]}
              />
              {policy === "allowlist" && (
                <div className={s.field} style={{ marginTop: 14 }}>
                  <label htmlFor="f-allow">Machine addresses, one per line (up to 10)</label>
                  <textarea
                    id="f-allow"
                    value={allow}
                    onChange={(e) => edit("allow", setAllow)(e.target.value)}
                    {...invalid("allow").attrs}
                  />
                  {invalid("allow").note}
                </div>
              )}
            </div>
          </fieldset>
        </form>
      </div>
      <aside className={s.side}>
        <section className={`${s.panel} ${s.sum}`} aria-label="Summary">
          <h2>Summary</h2>
          <div className={s.line}>
            <span>Reward</span>
            <span>{show(amount ?? undefined)}</span>
          </div>
          <div className={s.line}>
            <span>Machine receives (97.5%)</span>
            <span>{exact(split?.toMachine)}</span>
          </div>
          <div className={s.line}>
            <span>Samite fee (2.5%)</span>
            <span>{exact(split?.fee)}</span>
          </div>
          <div className={s.line}>
            <span>Deadline</span>
            <span>{deadline}</span>
          </div>
          <div className={s.line}>
            <span>Review window</span>
            <span>{review}</span>
          </div>
          <div className={s.total}>
            <span className={s.dim}>You lock now</span>
            <b>{show(amount ?? undefined)}</b>
          </div>
          <Ex block>+ Solana fees and account rent; rent comes back when the job closes</Ex>
          <div className={s.note}>
            If no delivery is accepted by the deadline, you take the full reward back. If a delivery arrives and you
            don&apos;t answer within the review window, it&apos;s paid automatically.
          </div>
          {/* never disabled for a problem in the form: a press always answers, with the list below */}
          <Button size="big" className={s.full} disabled={busy} onClick={submit}>
            {split && amount !== null ? `Lock ${short(amount)} USDC and post` : "Lock USDC and post"}
          </Button>
          <Ex block className={s.center}>
            {notice || (busy ? step || "Working…" : "You sign one transaction in your wallet")}
          </Ex>
          {tried && problems.length > 0 && (
            <div role="alert" className={s.invalid} style={{ marginTop: 12 }}>
              <div className={s.fixHead}>Fix this to post:</div>
              <ul className={s.fixList}>
                {problems.map((p) => (
                  <li key={`${p.field}:${p.message}`}>
                    <button type="button" onClick={() => document.getElementById(FIELD_ID[p.field])?.focus()}>
                      {p.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {errors.length > 0 && (
            <div role="alert" className={s.invalid} style={{ marginTop: 12 }}>
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
          {keep && written && (
            <p className={s.draftNote}>
              Kept in this browser until you post it.{" "}
              <button type="button" onClick={clearForm} disabled={busy}>
                Clear the form
              </button>
            </p>
          )}
        </section>
      </aside>
    </div>
  )
}
