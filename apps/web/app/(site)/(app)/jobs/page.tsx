import type { Metadata } from "next"
import { formatUsdc } from "@samite/config/money"
import { appClass as s, EscrowPrint, Feed, KV, Panel } from "@samite/ui/app"
import Link from "next/link"
import { isExample, requestTime, type Search } from "@/lib/data"
import { EXAMPLE_FEED, exampleBoardRows } from "@/lib/examples"
import { server } from "@/lib/server/context"
import { board, feed, stats } from "@/lib/server/jobs"
import { boardRow, type EventJson, type JobJson } from "@/lib/view"
import { Board } from "./Board"
import { LiveFeed } from "./LiveFeed"
import { YourMachine } from "./YourMachine"

export const metadata: Metadata = { title: "Open jobs" }

export default async function BoardPage({ searchParams }: { searchParams: Search }) {
  if (await isExample(searchParams)) return <ExampleBoard />
  const s0 = await server()
  const now = requestTime()
  const [open, st, latest] = await Promise.all([
    board(s0.db, { status: "open", limit: 100 }),
    stats(s0.db, now),
    feed(s0.db, { limit: 8 }),
  ])
  const summary = `${st.open_jobs} open · ${formatUsdc(BigInt(st.usdc_in_escrow), { decimals: 0 })} USDC in escrow`
  return (
    <main className={s.cols}>
      <div className={s.main}>
        <Board jobs={open.jobs.map((j) => boardRow(j as JobJson, now))} summary={summary} example={false} />
      </div>
      <aside className={s.side}>
        <YourMachine />
        <Panel title="Live">
          <LiveFeed initial={latest.events as EventJson[]} cursor={latest.cursor} now={now} />
        </Panel>
        {/* the escrow history needs a series the index doesn't keep yet: example until it does */}
        <Panel title="Escrow, last 24 h" example>
          <EscrowPrint className={s.print} />
        </Panel>
      </aside>
    </main>
  )
}

function ExampleBoard() {
  return (
    <main className={s.cols}>
      <div className={s.main}>
        <Board jobs={exampleBoardRows()} summary="128 open · 46,920 USDC in escrow" example />
      </div>
      <aside className={s.side}>
        <Panel title="Your machine" example>
          <div className={s.bigN}>
            {formatUsdc(412_500_000n)}
            <small>USDC earned</small>
          </div>
          <KV
            style={{ marginTop: 18 }}
            items={[
              ["Jobs done", "37"],
              ["Accepted", "35 / 37"],
              [
                "Now working on",
                <Link key="j" href="/jobs/0415?example">
                  JOB 0415
                </Link>,
              ],
              ["Connected via", "MCP"],
            ]}
          />
        </Panel>
        <Panel title="Live" example>
          <Feed items={EXAMPLE_FEED} />
        </Panel>
        <Panel title="Escrow, last 24 h" example>
          <EscrowPrint className={s.print} />
        </Panel>
      </aside>
    </main>
  )
}
