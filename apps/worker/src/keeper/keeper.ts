// The keeper (CLAUDE.md §7.2): finds jobs whose time is up and sends the permissionless instruction from the keeper
// key: release_after_review, refund_after_deadline, expire_claim. Off unless KEEPER_ENABLED=true; on mainnet the
// owner turns it on after an explicit "go" (M5).
//
// The index proposes candidates; the chain decides. Before sending, the keeper re-reads the job account and the
// chain's clock and applies the program's own rule (rules.ts), so a stale index never costs a failed transaction.
// The keeper never pays anyone's rent: if the recipient's USDC account is missing it skips the job and says so
// (re-creating it would let a user drain the keeper by closing their account again for the rent). The money is
// safe either way; the recipient re-creates their account and anyone can send the instruction.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"
import type { Address, Instruction } from "@solana/kit"
import { schema, type Db } from "@samite/db"
import { actions, type EscrowContext } from "@samite/program-client"
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token"
import { LIMITS } from "@samite/config/solana"
import { dueAction, type KeeperAction, type TimedJob } from "./rules"

export type ChainJob = TimedJob & { poster: Address; worker: Address | null }

/** What the keeper needs from the chain; implemented over the RPC (chain.ts) and over LiteSVM in tests. */
export interface KeeperChain {
  /** The chain's clock (`Clock.unix_timestamp`), not the server's. */
  now(): Promise<bigint>
  job(address: Address): Promise<ChainJob | null>
  exists(address: Address): Promise<boolean>
  /** `Config.treasury`, read from the chain. */
  treasury(): Promise<Address>
  /** Signs with the keeper key (fee payer, no authority) and sends; resolves to the signature. */
  send(instructions: Instruction[]): Promise<string>
}

export type KeeperOutcome = {
  pda: string
  jobNo: number
  action: KeeperAction
  result: "sent" | "skipped"
  detail: string
}

const { jobs } = schema
const HOLD_FLOOR = LIMITS.minResubmitSeconds

/** Live jobs the index thinks may be due at `now` (a superset; the chain decides). Hidden jobs included: money rules don't depend on moderation. */
export async function candidates(db: Db, now: bigint) {
  const n = now.toString()
  return db
    .select({ no: jobs.displayNo, pda: jobs.pda })
    .from(jobs)
    .where(
      and(
        isNull(jobs.closedAt),
        or(
          and(eq(jobs.status, "delivered"), sql`${jobs.deliveredAt} + ${jobs.reviewWindow} < ${n}::bigint`),
          and(inArray(jobs.status, ["open", "claimed"]), sql`${jobs.deadline} < ${n}::bigint`),
          and(
            eq(jobs.status, "claimed"),
            sql`${jobs.claimWindow} > 0`,
            sql`${jobs.claimedAt} + (case when ${jobs.deliveries} > 0 then greatest(${jobs.claimWindow}, ${HOLD_FLOOR}) else ${jobs.claimWindow} end) < ${n}::bigint`,
          ),
        ),
      ),
    )
    .orderBy(jobs.displayNo)
}

const ata = async (owner: Address, mint: Address) =>
  (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]

export async function keeperTick(o: {
  db: Db
  chain: KeeperChain
  ctx: EscrowContext
  log?: (line: Record<string, unknown>) => void
}) {
  const now = await o.chain.now()
  const out: KeeperOutcome[] = []
  for (const c of await candidates(o.db, now)) {
    const job = await o.chain.job(c.pda as Address)
    const action = job && dueAction(job, now)
    if (!job || !action) continue // closed or not due on-chain yet: the index is behind; nothing to send
    const report = (result: KeeperOutcome["result"], detail: string) => {
      const r = { pda: c.pda, jobNo: c.no, action, result, detail }
      out.push(r)
      o.log?.({ msg: "keeper", ...r })
    }
    let ix: Instruction
    if (action === "release") {
      const treasury = await o.chain.treasury()
      const machine = job.worker!
      if (!(await o.chain.exists(await ata(machine, o.ctx.usdcMint)))) {
        report("skipped", "the machine's USDC account is closed")
        continue
      }
      if (!(await o.chain.exists(treasury))) {
        report("skipped", "the treasury account is closed")
        continue
      }
      ix = await actions.releaseAfterReview(o.ctx, { job: c.pda as Address, poster: job.poster, machine, treasury })
    } else if (action === "refund") {
      if (!(await o.chain.exists(await ata(job.poster, o.ctx.usdcMint)))) {
        report("skipped", "the poster's USDC account is closed")
        continue
      }
      ix = await actions.refundAfterDeadline(o.ctx, { job: c.pda as Address, poster: job.poster })
    } else {
      ix = await actions.expireClaim(o.ctx, { job: c.pda as Address })
    }
    try {
      report("sent", await o.chain.send([ix]))
    } catch (e) {
      // someone else may have sent it first; the next tick re-reads the chain
      report("skipped", e instanceof Error ? e.message : String(e))
    }
  }
  return out
}
