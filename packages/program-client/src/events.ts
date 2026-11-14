// Decoding the program's events from a transaction. The program emits them with Anchor's `emit_cpi!`: an inner
// instruction to itself, signed by its event-authority PDA, whose data is EVENT_IX_TAG + the event's 8-byte
// discriminator + borsh. Only an instruction the program invokes on itself with its PDA's signature gets through
// (anyone else's CPI fails), so a successful transaction's inner instructions to the program with that tag are
// genuine. Logs are not used: they can be truncated.
import { getBase58Encoder, type Address, type ReadonlyUint8Array } from "@solana/kit"
import {
  getAdminAcceptedEventDecoder,
  getAdminProposedEventDecoder,
  getClaimExpiredEventDecoder,
  getConfigInitializedEventDecoder,
  getConfigUpdatedEventDecoder,
  getDeliveryRejectedEventDecoder,
  getDeliverySubmittedEventDecoder,
  getJobCancelledEventDecoder,
  getJobClaimedEventDecoder,
  getJobPaidEventDecoder,
  getJobPostedEventDecoder,
  getJobRefundedEventDecoder,
  getJobUnclaimedEventDecoder,
  identifySamiteEscrowEvent,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
  SamiteEscrowEvent,
  type AdminAcceptedEvent,
  type AdminProposedEvent,
  type ClaimExpiredEvent,
  type ConfigInitializedEvent,
  type ConfigUpdatedEvent,
  type DeliveryRejectedEvent,
  type DeliverySubmittedEvent,
  type JobCancelledEvent,
  type JobClaimedEvent,
  type JobPaidEvent,
  type JobPostedEvent,
  type JobRefundedEvent,
  type JobUnclaimedEvent,
} from "./generated"

/** anchor-lang 1.2.2 `event::EVENT_IX_TAG` (0x1d9acb512ea545e4), little-endian. */
export const EVENT_IX_TAG: ReadonlyUint8Array = new Uint8Array([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d])

export type EscrowEvent =
  | { name: "JobPosted"; data: JobPostedEvent }
  | { name: "JobCancelled"; data: JobCancelledEvent }
  | { name: "JobClaimed"; data: JobClaimedEvent }
  | { name: "JobUnclaimed"; data: JobUnclaimedEvent }
  | { name: "ClaimExpired"; data: ClaimExpiredEvent }
  | { name: "DeliverySubmitted"; data: DeliverySubmittedEvent }
  | { name: "DeliveryRejected"; data: DeliveryRejectedEvent }
  | { name: "JobPaid"; data: JobPaidEvent }
  | { name: "JobRefunded"; data: JobRefundedEvent }
  | { name: "ConfigInitialized"; data: ConfigInitializedEvent }
  | { name: "ConfigUpdated"; data: ConfigUpdatedEvent }
  | { name: "AdminProposed"; data: AdminProposedEvent }
  | { name: "AdminAccepted"; data: AdminAcceptedEvent }

/** An event and its position among the transaction's events (0, 1, …), which makes `(signature, ix)` unique. */
export type DecodedEscrowEvent = EscrowEvent & { ix: number }

/** The parts of a `getTransaction(sig, { encoding: "json", maxSupportedTransactionVersion: 0 })` response used here. */
export type EscrowTransaction = {
  slot: bigint
  blockTime: bigint | null
  meta: {
    err: unknown
    innerInstructions?:
      readonly { index: number; instructions: readonly { programIdIndex: number; data: string }[] }[] | null
    loadedAddresses?: { writable: readonly Address[]; readonly: readonly Address[] }
  } | null
  transaction: { message: { accountKeys: readonly Address[] }; signatures: readonly string[] }
}

function decodeEvent(bytes: ReadonlyUint8Array): EscrowEvent {
  switch (identifySamiteEscrowEvent(bytes)) {
    case SamiteEscrowEvent.JobPosted:
      return { name: "JobPosted", data: getJobPostedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.JobCancelled:
      return { name: "JobCancelled", data: getJobCancelledEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.JobClaimed:
      return { name: "JobClaimed", data: getJobClaimedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.JobUnclaimed:
      return { name: "JobUnclaimed", data: getJobUnclaimedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.ClaimExpired:
      return { name: "ClaimExpired", data: getClaimExpiredEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.DeliverySubmitted:
      return { name: "DeliverySubmitted", data: getDeliverySubmittedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.DeliveryRejected:
      return { name: "DeliveryRejected", data: getDeliveryRejectedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.JobPaid:
      return { name: "JobPaid", data: getJobPaidEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.JobRefunded:
      return { name: "JobRefunded", data: getJobRefundedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.ConfigInitialized:
      return { name: "ConfigInitialized", data: getConfigInitializedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.ConfigUpdated:
      return { name: "ConfigUpdated", data: getConfigUpdatedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.AdminProposed:
      return { name: "AdminProposed", data: getAdminProposedEventDecoder().decode(bytes) }
    case SamiteEscrowEvent.AdminAccepted:
      return { name: "AdminAccepted", data: getAdminAcceptedEventDecoder().decode(bytes) }
  }
}

const startsWith = (data: ReadonlyUint8Array, prefix: ReadonlyUint8Array) =>
  data.length >= prefix.length && prefix.every((b, i) => data[i] === b)

/**
 * The program's events in the order they were emitted. A failed transaction has none (its events were rolled back).
 * Throws on an event CPI it can't decode: the indexer must stop rather than skip money movements silently.
 */
export function decodeEscrowEvents(
  tx: EscrowTransaction,
  programAddress: Address = SAMITE_ESCROW_PROGRAM_ADDRESS,
): DecodedEscrowEvent[] {
  if (!tx.meta || tx.meta.err != null) return []
  const keys = [
    ...tx.transaction.message.accountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ]
  const base58 = getBase58Encoder()
  const out: DecodedEscrowEvent[] = []
  const groups = [...(tx.meta.innerInstructions ?? [])].sort((a, b) => a.index - b.index)
  for (const group of groups)
    for (const ix of group.instructions) {
      if (keys[ix.programIdIndex] !== programAddress) continue
      const data = base58.encode(ix.data)
      if (!startsWith(data, EVENT_IX_TAG)) continue
      out.push({ ...decodeEvent(data.slice(EVENT_IX_TAG.length)), ix: out.length })
    }
  return out
}
