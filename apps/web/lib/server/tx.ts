// /tx/:action (§6.1): unsigned transactions + a plain summary. The server never signs: the fee payer and every signer
// are the caller, as no-op signers. Each builder reads the job from the chain (not the index) to check it can work,
// and the summary is computed from the same values that go into the instruction (Review Focus 3).
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isSome,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type Signature,
} from "@solana/kit"
import { findAssociatedTokenPda, getTokenSize, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token"
import { LIMITS } from "@samite/config/solana"
import { formatUsdc, splitReward } from "@samite/config/money"
import { and, eq, isNull } from "drizzle-orm"
import { schema } from "@samite/db"
import {
  actions,
  claimPolicy,
  defaultClaimWindow,
  fetchConfig,
  fetchMaybeJob,
  fetchMaybeMachineStats,
  findConfigPda,
  findMachineStatsPda,
  getMachineStatsSize,
  JOB_ACCOUNT_BYTES,
  JobStatus,
  MIN_CLAIM_WINDOW,
  type Job,
} from "@samite/program-client"
import type { Server } from "./context"
import { ApiError } from "./errors"
import { bigintField, stringField } from "./http"
import { findJob } from "./jobs"
import { explainFailure, type Needs } from "./preflight"

export const TX_ACTIONS = ["post", "cancel", "claim", "unclaim", "deliver", "accept", "reject"] as const
export type TxAction = (typeof TX_ACTIONS)[number]
const LAMPORTS_PER_SIGNATURE = 5_000n

export type TxSummary = {
  action: TxAction
  job: string
  payer: string
  /** What moves, in base units (strings) and in words. */
  usdc: Record<string, string>
  lines: string[]
  network_fee_lamports: string
  rent_lamports: string
  rent_note: string | null
}

const hex = (s: string) => {
  if (!/^[0-9a-f]{64}$/.test(s)) throw new ApiError("bad_request", "A hash is 64 lowercase hex digits.")
  return new Uint8Array(Buffer.from(s, "hex"))
}

async function chainJob(s: Server, pda: Address): Promise<Job> {
  const a = await fetchMaybeJob(s.rpc, pda, { commitment: "confirmed" })
  if (!a.exists) throw new ApiError("chain_state", "This job is closed on-chain.")
  return a.data
}

/**
 * Compiles the unsigned transaction and simulates it first (preflight.ts): one that would fail on-chain is refused
 * here with what is missing, so no wallet is asked to sign it.
 */
async function wire(s: Server, payer: Address, ixs: Instruction[], need: Omit<Needs, "lamports">) {
  const { value: blockhash } = await s.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(createNoopSigner(payer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  )
  const tx = compileTransaction(msg)
  const transaction = getBase64EncodedWireTransaction(tx)
  const signers = Object.keys(tx.signatures).length
  const { value: sim } = await s.rpc
    .simulateTransaction(transaction, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    })
    .send()
  if (sim.err) {
    const [{ value: lamports }, usdc] = await Promise.all([
      s.rpc.getBalance(payer, { commitment: "confirmed" }).send(),
      usdcHeld(s, payer),
    ])
    throw explainFailure(
      { err: sim.err, logs: sim.logs },
      { ...need, lamports: need.rent + LAMPORTS_PER_SIGNATURE * BigInt(signers) },
      { lamports, usdc },
    )
  }
  return { transaction, signers, expires_after_block: Number(blockhash.lastValidBlockHeight) }
}

/** The USDC in the wallet's associated token account, or null if it has none. */
async function usdcHeld(s: Server, owner: Address): Promise<bigint | null> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: s.escrow.usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS })
  try {
    const { value } = await s.rpc.getTokenAccountBalance(ata, { commitment: "confirmed" }).send()
    return BigInt(value.amount)
  } catch {
    return null // no such account
  }
}

const usdc = (v: bigint) => `${formatUsdc(v, { decimals: "exact" })} USDC`
const now = () => BigInt(Math.floor(Date.now() / 1000))

/** Reads a duration in seconds from a number or "48h" / "3d" / "90m". */
export function seconds(v: unknown, name: string): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v)
  const m = typeof v === "string" ? v.match(/^(\d{1,7})([mhd])$/) : null
  if (!m) throw new ApiError("bad_request", `${name} is seconds, or a duration like "90m", "48h", "3d".`)
  return BigInt(m[1]!) * { m: 60n, h: 3_600n, d: 86_400n }[m[2] as "m" | "h" | "d"]
}

export async function buildTx(s: Server, action: TxAction, caller: Address, b: Record<string, unknown>) {
  const signer = createNoopSigner(caller)
  const ctx = s.escrow
  const lines: string[] = []
  const amounts: Record<string, string> = {}
  let rent = 0n
  let rentNote: string | null = null
  let ixs: Instruction[]
  let jobAddress: string

  if (action === "post") {
    const specHash = stringField(b.spec_hash, "spec_hash")
    const [spec] = await s.db.select().from(schema.specs).where(eq(schema.specs.specHash, specHash))
    if (!spec) throw new ApiError("not_found", "Store the spec first: POST /api/v1/specs.")
    if (spec.verdict !== "pass")
      throw new ApiError(
        "spec_refused",
        spec.verdict === "refuse" ? "This spec was refused." : "This spec hasn't passed moderation yet.",
        { reasons: spec.reasons },
      )
    const reward = bigintField(b.reward, "reward")
    const config = await fetchConfig(s.rpc, (await findConfigPda({ programAddress: s.program }))[0], {
      commitment: "confirmed",
    })
    if (config.data.paused)
      throw new ApiError("chain_state", "Posting is paused right now. Jobs already posted are unaffected.")
    if (reward < config.data.minReward)
      throw new ApiError("bad_request", `The reward is at least ${usdc(config.data.minReward)}.`)
    const t = now()
    const deadline =
      typeof b.deadline === "number" && b.deadline > 1e9
        ? BigInt(b.deadline)
        : t + seconds(b.deadline ?? "3d", "deadline")
    const reviewWindow = seconds(b.review_window ?? "48h", "review_window")
    // every claim lapses (no 0 since Nov 13): a named window must fit before the deadline; none means 24 h or less
    const claimWindow =
      b.claim_window === undefined ? defaultClaimWindow(deadline, t) : seconds(b.claim_window, "claim_window")
    if (claimWindow < MIN_CLAIM_WINDOW || claimWindow > deadline - t)
      throw new ApiError(
        "bad_request",
        "claim_window must be between 1 hour and the time left before the deadline: every claim lapses.",
      )
    const policy =
      b.policy === "proven"
        ? claimPolicy("Proven", { minAccepted: Number(b.min_accepted ?? 5) })
        : b.policy === "allowlist"
          ? claimPolicy("Allowlist")
          : claimPolicy("Any")
    const allowlist = Array.isArray(b.allowlist) ? b.allowlist.map((a) => address(String(a))) : []
    const p = await actions.postJob(ctx, {
      poster: signer,
      reward,
      deadline,
      reviewWindow,
      claimWindow,
      policy,
      allowlist,
      specHash: hex(specHash),
    })
    ixs = [p.instruction]
    jobAddress = p.job
    // the fee in the summary is the fee this job will carry: Config.fee_bps, snapshotted at post time
    const { toMachine, fee } = splitReward(reward, config.data.feeBps)
    rent =
      (await s.rpc.getMinimumBalanceForRentExemption(BigInt(JOB_ACCOUNT_BYTES)).send()) +
      (await s.rpc.getMinimumBalanceForRentExemption(BigInt(getTokenSize())).send())
    rentNote = "Account rent for the job and its escrow; it comes back to you when the job closes."
    Object.assign(amounts, { lock: reward.toString(), to_machine: toMachine.toString(), fee: fee.toString() })
    lines.push(
      `You lock ${usdc(reward)} in this job's escrow now.`,
      `If a delivery is accepted, ${usdc(toMachine)} goes to the machine and ${usdc(fee)} (${config.data.feeBps / 100}%) to Samite.`,
      "If no delivery is accepted by the deadline, the full reward comes back to you.",
      `If a delivery arrives and you don't answer within ${Number(reviewWindow) / 3600} h, it is paid automatically.`,
    )
  } else {
    const ref = stringField(b.job, "job")
    const row = await findJob(s.db, ref, { includeHidden: true })
    const pda = address(row.pda)
    jobAddress = pda
    const j = await chainJob(s, pda)
    const worker = isSome(j.worker) ? j.worker.value : null
    const { toMachine, fee } = splitReward(j.reward, j.feeBps)
    const is = (st: JobStatus, msg: string) => {
      if (j.status !== st) throw new ApiError("chain_state", msg)
    }
    const posterOnly = () => {
      if (j.poster !== caller) throw new ApiError("forbidden", "Only the poster can do this.")
    }
    const workerOnly = () => {
      if (worker !== caller) throw new ApiError("forbidden", "Only the machine working on this job can do this.")
    }

    if (action === "cancel") {
      posterOnly()
      is(JobStatus.Open, "Only an open job with no claim can be cancelled.")
      ixs = [await actions.cancelJob(ctx, { poster: signer, job: pda })]
      amounts.refund = j.reward.toString()
      lines.push(`The full ${usdc(j.reward)} comes back to you, and the job's rent too. No fee.`)
    } else if (action === "claim") {
      is(JobStatus.Open, "This job is not open.")
      if (j.poster === caller) throw new ApiError("forbidden", "You can't claim your own job.")
      if (isSome(j.previousWorker) && j.previousWorker.value === caller)
        throw new ApiError(
          "forbidden",
          "You left this job (dropped it, or your claim expired), so you can't claim it again. Another machine can.",
        )
      if (j.deadline <= now()) throw new ApiError("chain_state", "The deadline has passed.")
      const [ata] = await findAssociatedTokenPda({
        owner: caller,
        mint: ctx.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
      if (!(await fetchEncodedAccount(s.rpc, ata, { commitment: "confirmed" })).exists)
        throw new ApiError("chain_state", "Your wallet needs a USDC account before it can claim (so it can be paid).")
      const [stats] = await findMachineStatsPda({ machine: caller }, { programAddress: s.program })
      if (!(await fetchMaybeMachineStats(s.rpc, stats, { commitment: "confirmed" })).exists) {
        rent = await s.rpc.getMinimumBalanceForRentExemption(BigInt(getMachineStatsSize())).send()
        rentNote =
          "One-time rent for your machine's record on-chain (accepted and rejected counts). It stays with the record."
      }
      ixs = [await actions.claimJob(ctx, { machine: signer, job: pda })]
      lines.push(`You take this job. If your delivery is accepted, you receive ${usdc(toMachine)}.`)
    } else if (action === "unclaim") {
      workerOnly()
      is(JobStatus.Claimed, "You can drop a job only while it's claimed and not delivered.")
      ixs = [await actions.unclaimJob(ctx, { machine: signer, job: pda })]
      lines.push("You drop this job; it reopens for other machines, and you can't claim it again. No money moves.")
    } else if (action === "deliver") {
      workerOnly()
      is(JobStatus.Claimed, "You can deliver only while the job is claimed by you.")
      const h = stringField(b.delivery_hash, "delivery_hash")
      const [stored] = await s.db
        .select()
        .from(schema.deliveries)
        .where(
          and(
            eq(schema.deliveries.jobNo, row.displayNo),
            eq(schema.deliveries.deliveryHash, h),
            isNull(schema.deliveries.submittedSig),
          ),
        )
      if (!stored) throw new ApiError("not_found", "Store the delivery first: POST /api/v1/deliveries.")
      ixs = [await actions.submitDelivery(ctx, { machine: signer, job: pda, deliveryHash: hex(h) })]
      lines.push(
        `You submit delivery ${j.deliveries + 1} of ${LIMITS.maxDeliveries}. Its hash goes on-chain; the poster reviews it.`,
      )
    } else if (action === "accept") {
      posterOnly()
      is(JobStatus.Delivered, "There's no delivery waiting for review.")
      const config = await fetchConfig(s.rpc, (await findConfigPda({ programAddress: s.program }))[0], {
        commitment: "confirmed",
      })
      ixs = [
        await actions.acceptDelivery(ctx, {
          poster: signer,
          job: pda,
          machine: worker!,
          treasury: config.data.treasury,
        }),
      ]
      Object.assign(amounts, { to_machine: toMachine.toString(), fee: fee.toString() })
      lines.push(
        `${usdc(toMachine)} goes to the machine and ${usdc(fee)} (${j.feeBps / 100}%) to Samite, in this transaction. The job's rent comes back to you.`,
      )
    } else {
      posterOnly()
      is(JobStatus.Delivered, "There's no delivery waiting for review.")
      if (now() > j.deliveredAt + j.reviewWindow)
        throw new ApiError("chain_state", "The review window has passed; the delivery is paid automatically.")
      const h = stringField(b.reason_hash, "reason_hash")
      const [stored] = await s.db
        .select()
        .from(schema.rejections)
        .where(
          and(
            eq(schema.rejections.jobNo, row.displayNo),
            eq(schema.rejections.reasonHash, h),
            isNull(schema.rejections.sig),
          ),
        )
      if (!stored) throw new ApiError("not_found", "Store the reason first: POST /api/v1/jobs/:ref/rejection.")
      ixs = [await actions.rejectDelivery(ctx, { poster: signer, job: pda, machine: worker!, reasonHash: hex(h) })]
      lines.push(
        j.deliveries >= LIMITS.maxDeliveries
          ? `This is the last allowed delivery: rejecting it refunds the full ${usdc(j.reward)} to you and closes the job.`
          : "The machine keeps the job and may deliver again (at least 24 h before the deadline). Your reason is public.",
      )
    }
  }

  const tx = await wire(s, caller, ixs, {
    rent,
    rentComesBack: action === "post",
    usdc: amounts.lock ? BigInt(amounts.lock) : 0n,
  })
  const summary: TxSummary = {
    action,
    job: jobAddress,
    payer: caller,
    usdc: amounts,
    lines,
    network_fee_lamports: (LAMPORTS_PER_SIGNATURE * BigInt(tx.signers)).toString(),
    rent_lamports: rent.toString(),
    rent_note: rentNote,
  }
  return { ...tx, summary }
}

/** The native compute-budget program (checked on mainnet: executable, owned by the native loader). */
const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111")
/**
 * Lighthouse: Phantom may add its balance assertions to a transaction it signs ("Transaction validation",
 * docs.phantom.com). Id from github.com/jac0xb/lighthouse, checked on mainnet Nov 14: executable, upgradeable loader.
 */
const LIGHTHOUSE_PROGRAM = address("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95")
/** What a wallet may add to a Samite transaction it signs: a priority fee, Phantom's assertions. */
const WALLET_ADDED: ReadonlySet<Address> = new Set([COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM])
const hideKeys = (m: string) => m.replace(/api-key=[^&\s"]+/g, "api-key=***")

/** /tx/send: relays a fully signed transaction, only if it calls this program (the API is not a general relay). */
/** A transaction's status as the server's RPC sees it (GET /api/v1/tx/status). */
export async function txStatus(s: Server, signature: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
    throw new ApiError("bad_request", "signature is a base58 transaction signature.")
  const { value } = await s.rpc.getSignatureStatuses([signature as Signature]).send()
  const st = value[0]
  return { signature, status: st?.confirmationStatus ?? null, err: st?.err ?? null }
}

export async function relay(s: Server, base64: string) {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(getBase64Encoder().encode(base64))
    getTransactionDecoder().decode(bytes)
  } catch {
    throw new ApiError("tx_invalid", "transaction is not a base64 wire transaction.")
  }
  // every instruction must call the escrow program or a program a wallet adds (WALLET_ADDED), and at least one must
  // call the escrow program: not a general relay (SECURITY-REVIEW B3). Program ids are always static account keys.
  const msg = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes)
  const programs =
    msg.version === 1
      ? msg.instructionHeaders.map((h) => msg.staticAccounts[h.programAccountIndex])
      : msg.instructions.map((ix) => msg.staticAccounts[ix.programAddressIndex])
  const other = [...new Set(programs.filter((p) => p !== s.program && !WALLET_ADDED.has(p!)))]
  if (!programs.includes(s.program) || other.length) {
    // program ids are public: the log shows what a wallet added, should another one add something new
    console.log(JSON.stringify({ msg: "relay_refused", programs: [...new Set(programs)] }))
    throw new ApiError(
      "tx_invalid",
      `This relay only sends Samite escrow transactions (with the compute-budget and Lighthouse instructions a wallet may add)${other.length ? `; this one also calls ${other.join(", ")}` : ""}. Send others through your own RPC.`,
    )
  }
  try {
    return await s.rpc.sendTransaction(base64 as never, { encoding: "base64", preflightCommitment: "confirmed" }).send()
  } catch (e) {
    const why = hideKeys(e instanceof Error ? e.message : String(e))
    console.log(JSON.stringify({ msg: "relay_network_refused", error: why.slice(0, 500) }))
    throw new ApiError("tx_invalid", `The network refused the transaction: ${why}`)
  }
}
