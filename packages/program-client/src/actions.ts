// One builder per user-facing instruction, with every derived account filled in (job PDA, ATAs, stats, event CPI).
// The API's /tx/* routes, the keeper, the SDK and the local scripts all build through these, so the accounts a
// transaction touches are decided in one place. Signers can be real (the SDK, the keeper) or `createNoopSigner`
// (the API builds unsigned transactions; the user's wallet signs).
import { type Address, type Instruction, type ReadonlyUint8Array, type TransactionSigner } from "@solana/kit"
import {
  findJobPda,
  getAcceptDeliveryInstructionAsync,
  getCancelJobInstructionAsync,
  getClaimJobInstructionAsync,
  getExpireClaimInstruction,
  getPostJobInstructionAsync,
  getRefundAfterDeadlineInstructionAsync,
  getRejectDeliveryInstructionAsync,
  getReleaseAfterReviewInstructionAsync,
  getSubmitDeliveryInstruction,
  getUnclaimJobInstruction,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
  type ClaimPolicyArgs,
} from "./generated"
import { eventCpiAccounts } from "./helpers"

export type EscrowContext = { usdcMint: Address; programAddress?: Address }

/** A random u64 job id: the job PDA is ["job", poster, job_id], so a fresh id never collides with a live job. */
export function randomJobId(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(8))
  return b.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n)
}

const program = (ctx: EscrowContext) => ctx.programAddress ?? SAMITE_ESCROW_PROGRAM_ADDRESS
const common = async (ctx: EscrowContext) => ({ usdcMint: ctx.usdcMint, ...(await eventCpiAccounts(program(ctx))) })
const cfg = (ctx: EscrowContext) => ({ programAddress: program(ctx) })

export type PostJobArgs = {
  poster: TransactionSigner
  jobId?: bigint
  reward: bigint
  deadline: bigint
  reviewWindow: bigint
  claimWindow: bigint
  policy: ClaimPolicyArgs
  allowlist?: Address[]
  specHash: ReadonlyUint8Array
}

export async function postJob(
  ctx: EscrowContext,
  a: PostJobArgs,
): Promise<{ instruction: Instruction; job: Address; jobId: bigint }> {
  const jobId = a.jobId ?? randomJobId()
  const [job] = await findJobPda({ poster: a.poster.address, jobId }, cfg(ctx))
  const instruction = await getPostJobInstructionAsync(
    {
      ...(await common(ctx)),
      poster: a.poster,
      job,
      jobId,
      reward: a.reward,
      deadline: a.deadline,
      reviewWindow: a.reviewWindow,
      claimWindow: a.claimWindow,
      policy: a.policy,
      allowlist: a.allowlist ?? [],
      specHash: a.specHash,
    },
    cfg(ctx),
  )
  return { instruction, job, jobId }
}

export const cancelJob = async (ctx: EscrowContext, a: { poster: TransactionSigner; job: Address }) =>
  getCancelJobInstructionAsync({ ...(await common(ctx)), poster: a.poster, job: a.job }, cfg(ctx))

export const claimJob = async (ctx: EscrowContext, a: { machine: TransactionSigner; job: Address }) =>
  getClaimJobInstructionAsync({ ...(await common(ctx)), machine: a.machine, job: a.job }, cfg(ctx))

export const unclaimJob = async (ctx: EscrowContext, a: { machine: TransactionSigner; job: Address }) =>
  getUnclaimJobInstruction({ ...(await eventCpiAccounts(program(ctx))), machine: a.machine, job: a.job }, cfg(ctx))

export const submitDelivery = async (
  ctx: EscrowContext,
  a: { machine: TransactionSigner; job: Address; deliveryHash: ReadonlyUint8Array },
) =>
  getSubmitDeliveryInstruction(
    { ...(await eventCpiAccounts(program(ctx))), machine: a.machine, job: a.job, deliveryHash: a.deliveryHash },
    cfg(ctx),
  )

/** `machine` is the job's worker; `treasury` is `Config.treasury` (read it from the chain, never from the client). */
export const acceptDelivery = async (
  ctx: EscrowContext,
  a: { poster: TransactionSigner; job: Address; machine: Address; treasury: Address },
) =>
  getAcceptDeliveryInstructionAsync(
    { ...(await common(ctx)), poster: a.poster, job: a.job, machine: a.machine, treasury: a.treasury },
    cfg(ctx),
  )

export const rejectDelivery = async (
  ctx: EscrowContext,
  a: { poster: TransactionSigner; job: Address; machine: Address; reasonHash: ReadonlyUint8Array },
) =>
  getRejectDeliveryInstructionAsync(
    { ...(await common(ctx)), poster: a.poster, job: a.job, machine: a.machine, reasonHash: a.reasonHash },
    cfg(ctx),
  )

// The permissionless time-outs (§4.3): anyone may send them; the money can only go where the rules say.

export const releaseAfterReview = async (
  ctx: EscrowContext,
  a: { job: Address; poster: Address; machine: Address; treasury: Address },
) => getReleaseAfterReviewInstructionAsync({ ...(await common(ctx)), ...a }, cfg(ctx))

export const refundAfterDeadline = async (ctx: EscrowContext, a: { job: Address; poster: Address }) =>
  getRefundAfterDeadlineInstructionAsync({ ...(await common(ctx)), ...a }, cfg(ctx))

export const expireClaim = async (ctx: EscrowContext, a: { job: Address }) =>
  getExpireClaimInstruction({ ...(await eventCpiAccounts(program(ctx))), job: a.job }, cfg(ctx))

/** How long a claim may hold without a delivery, as the program checks it (`MIN_CLAIM_WINDOW`; no 0 since Nov 13). */
export const MIN_CLAIM_WINDOW = 3_600n

/**
 * The claim window when the poster names none: 24 h, or the time left before the deadline less 10 minutes if that is
 * shorter (the program measures from when the transaction lands), never under 1 h. Every claim lapses, so no machine
 * can sit on a job until its deadline.
 */
export function defaultClaimWindow(deadline: bigint, now: bigint): bigint {
  const left = deadline - now - 600n
  if (left >= 86_400n) return 86_400n
  return left > MIN_CLAIM_WINDOW ? left : MIN_CLAIM_WINDOW
}
