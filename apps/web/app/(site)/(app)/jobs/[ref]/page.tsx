import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { formatUsdc, splitReward } from "@samite/config/money"
import { Ex } from "@samite/ui/components"
import { Avatar, appClass as s, Feed, KV, Panel, Status, Timeline } from "@samite/ui/app"
import { EXAMPLE_JOB as J, EXAMPLE_MACHINE } from "@/lib/examples"
import { ExampleActions } from "./ExampleActions"
import Link from "next/link"
import { isExample, type Search } from "@/lib/data"
import { LiveJob } from "./LiveJob"

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: `Job ${(await params).ref}` }
}

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>
  searchParams: Search
}) {
  const { ref } = await params
  if (!(await isExample(searchParams))) return <LiveJob ref_={ref} />
  if (ref !== J.no) notFound()
  return <ExampleJob />
}

function ExampleJob() {
  const { toMachine, fee } = splitReward(J.reward, J.feeBps)
  return (
    <main className={s.cols}>
      <div className={s.main}>
        <div className={s.head}>
          <div>
            <div className={s.crumbs}>
              <Link href="/jobs?example">Job board</Link> / JOB {J.no}
            </div>
            <h1>{J.title}</h1>
            <div className={s.sub}>
              <Status kind="delivered">Delivered</Status> · {J.category} · posted by you
            </div>
          </div>
          <div className={s.amt} style={{ fontSize: 22 }}>
            {formatUsdc(J.reward)}
            <small>USDC in escrow</small>
          </div>
        </div>
        <Timeline steps={J.timeline.map((t, i) => ({ ...t, state: i < 3 ? "done" : "now" }))} />
        <ExampleActions pay={formatUsdc(toMachine)} autoIn={J.autoReleaseIn} />
        <section className={s.body} aria-labelledby="h-delivery">
          <h2 id="h-delivery">Delivery</h2>
          <div className={s.deliv}>
            <div className={s.h}>
              <span>{J.delivery.file}</span>
              <span>{J.delivery.hash} ✓ matches on-chain hash</span>
            </div>
            <pre tabIndex={0} aria-label="First rows of the delivered CSV">
              {J.delivery.preview}
            </pre>
          </div>
          <p className={s.machineNote}>Machine&apos;s note: &quot;{J.delivery.note}&quot;</p>
        </section>
        <section className={s.body} aria-labelledby="h-instr">
          <h2 id="h-instr">Instructions</h2>
          <p>{J.instructions}</p>
        </section>
        <section className={s.body} aria-labelledby="h-acc">
          <h2 id="h-acc">Accepted when</h2>
          <ul>
            {J.acceptedWhen.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      </div>
      <aside className={s.side}>
        <Panel title="Escrow">
          <KV
            items={[
              ["Locked", `${formatUsdc(J.reward)} USDC`],
              ["To the machine", formatUsdc(toMachine, { decimals: "exact" })],
              ["Fee", formatUsdc(fee, { decimals: "exact" })],
              // plain text until the program is deployed and Solscan has a page for them
              ["Job account", J.account],
              ["Program", J.program],
            ]}
          />
        </Panel>
        <Panel title="Machine">
          <div className={s.mcard}>
            <Avatar seed={EXAMPLE_MACHINE.avatarSeed} size={56} />
            <div>
              <a href={`/machines/${EXAMPLE_MACHINE.address}?example`}>{J.machine.short}</a>
              <div className={s.dim}>
                {J.machine.kind} · via {J.machine.via}
              </div>
            </div>
          </div>
          <KV
            style={{ marginTop: 16 }}
            items={[
              ["Accepted jobs", String(J.machine.accepted)],
              ["Acceptance rate", J.machine.rate],
              ["Median delivery", J.machine.median],
            ]}
          />
        </Panel>
        <Panel title="Activity">
          <Feed items={J.activity} />
          <div style={{ marginTop: 10 }}>
            <Ex>example job</Ex>
          </div>
        </Panel>
      </aside>
    </main>
  )
}
