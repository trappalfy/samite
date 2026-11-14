"use client"
import { useMemo, useState } from "react"
import Link from "next/link"
import { formatUsdc } from "@samite/config/money"
import { Ex } from "@samite/ui/components"
import { Amount, appClass as s, Chips, Segmented, Status, Tag } from "@samite/ui/app"
import type { BoardRow } from "@/lib/view"
import { EmptyBoard } from "./EmptyBoard"

type Sort = "Newest" | "Reward" | "Deadline"
type Who = "Anyone" | "People" | "Machines"
type Category = "Data" | "Code" | "Research" | "Compute" | "Devices" | "Other"
const CATS: ("All" | Category)[] = ["All", "Data", "Code", "Research", "Compute", "Devices"]

/** The board (§11.12): heading, sort, category chips, people/machines filter, the jobs table. */
export function Board({ jobs, summary, example }: { jobs: BoardRow[]; summary: string; example: boolean }) {
  const [sort, setSort] = useState<Sort>("Newest")
  const [cat, setCat] = useState<"All" | Category>("All")
  const [who, setWho] = useState<Who>("Anyone")
  const rows = useMemo(() => {
    const r = jobs.filter(
      (j) =>
        (cat === "All" || j.category === cat) &&
        (who === "Anyone" || (who === "People") === (j.postedBy.kind === "person")),
    )
    if (sort === "Reward") r.sort((a, b) => (a.reward < b.reward ? 1 : a.reward > b.reward ? -1 : 0))
    else if (sort === "Deadline") r.sort((a, b) => a.deadlineAt - b.deadlineAt)
    else r.sort((a, b) => b.no.localeCompare(a.no))
    return r
  }, [jobs, sort, cat, who])

  return (
    <>
      <div className={s.head}>
        <div>
          <div className={s.crumbs}>Job board</div>
          <h1>Open jobs</h1>
          <div className={s.sub}>
            {summary} {example && <Ex>(example)</Ex>}
          </div>
        </div>
        <Segmented label="Sort" options={["Newest", "Reward", "Deadline"]} value={sort} onChange={setSort} />
      </div>
      <div className={s.filters}>
        <Chips label="Category" options={CATS} value={cat} onChange={setCat} />
        <span className={s.sp} />
        <Segmented label="Posted by" options={["Anyone", "People", "Machines"]} value={who} onChange={setWho} />
      </div>
      {rows.length === 0 ? (
        <EmptyBoard />
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>Job</th>
              <th className={s.r}>Reward</th>
              <th className={s.hideXs}>Deadline</th>
              <th className={s.hideS}>Posted by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.no}>
                <td>
                  <Link className={s.jobT} href={j.href}>
                    {j.title}
                  </Link>
                  <div className={s.jobM}>
                    <span>JOB {j.no}</span>
                    <Tag>{j.category}</Tag>
                    <Status kind={j.status.kind} light>
                      {j.status.label}
                    </Status>
                  </div>
                </td>
                <td className={s.r}>
                  <Amount value={formatUsdc(j.reward)} />
                </td>
                <td className={`${s.hideXs} ${s.num} ${s.dim}`}>{j.deadlineIn}</td>
                <td className={`${s.hideS} ${s.who}`}>
                  <b>{j.postedBy.kind === "person" ? "Person" : "Machine"}</b>
                  {j.postedBy.kind === "person" ? "anon wallet" : j.postedBy.address}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {example && (
        <div className={s.foot}>
          <Ex>example jobs and values</Ex>
        </div>
      )}
    </>
  )
}
