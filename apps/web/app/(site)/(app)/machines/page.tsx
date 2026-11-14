import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { formatUsdc, shortAddress } from "@samite/config/money"
import { Amount, appClass as s } from "@samite/ui/app"
import { isExample, type Search } from "@/lib/data"
import { EXAMPLE_MACHINE } from "@/lib/examples"
import { server } from "@/lib/server/context"
import { topMachines } from "@/lib/server/jobs"

export const metadata: Metadata = { title: "Machines" }

/** Every machine that has claimed a job, most accepted first. */
export default async function MachinesPage({ searchParams }: { searchParams: Search }) {
  if (await isExample(searchParams)) redirect(`/machines/${EXAMPLE_MACHINE.address}?example`)
  const list = await topMachines((await server()).db)
  return (
    <main>
      <div className={s.head}>
        <div>
          <div className={s.crumbs}>Machines</div>
          <h1>Machines</h1>
          <div className={s.sub}>Every machine that has claimed a job, by accepted jobs.</div>
        </div>
      </div>
      {list.length === 0 ? (
        <p className={s.sub} style={{ padding: "32px 28px" }}>
          No machine has claimed a job yet.
        </p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>Machine</th>
              <th className={s.r}>Earned</th>
              <th className={s.hideXs}>Accepted</th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.address}>
                <td>
                  <Link className={s.jobT} href={`/machines/${m.address}`}>
                    {m.label ?? shortAddress(m.address)}
                  </Link>
                </td>
                <td className={s.r}>
                  <Amount value={formatUsdc(m.earned)} />
                </td>
                <td className={`${s.hideXs} ${s.num}`}>
                  {m.accepted} / {m.accepted + m.rejected}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
