// What the browser checks before the wallet signs a transaction the API built (§12, review R1). The API could be
// compromised; the page knows what it asked for. A transaction is signed only if it holds exactly one Samite escrow
// instruction of the expected kind, for this job, signed as the connected wallet, with the amounts and hashes the
// page computed itself, and nothing else but compute-budget instructions (a priority fee).
import {
  address,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit"
import {
  parseSamiteEscrowInstruction,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
  SamiteEscrowInstruction as I,
} from "@samite/program-client"

/** The native compute-budget program (checked on mainnet: executable, owned by the native loader). */
const COMPUTE_BUDGET = address("ComputeBudget111111111111111111111111111111")

/** The program the browser expects; NEXT_PUBLIC_PROGRAM_ID after the owner's deploy (M5). */
export const PROGRAM: Address = address(process.env.NEXT_PUBLIC_PROGRAM_ID || SAMITE_ESCROW_PROGRAM_ADDRESS)

export type Expected = { job: Address } & (
  | { action: "post"; reward: bigint; specHash: string }
  | { action: "cancel" | "unclaim" }
  | { action: "accept"; machine: Address }
  | { action: "reject"; machine: Address; reasonHash: string }
)

const KIND = {
  post: I.PostJob,
  cancel: I.CancelJob,
  unclaim: I.UnclaimJob,
  accept: I.AcceptDelivery,
  reject: I.RejectDelivery,
} as const
/** Which account of the instruction is the wallet's own signature. */
const SIGNER = { post: "poster", cancel: "poster", unclaim: "machine", accept: "poster", reject: "poster" } as const

const hex = (b: ReadonlyUint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")

/** null if the transaction does exactly what the page asked for; otherwise why it must not be signed. */
export function verifyTransaction(
  base64: string,
  e: Expected,
  signer: Address,
  program: Address = PROGRAM,
): string | null {
  let msg: ReturnType<typeof decompileTransactionMessage>
  try {
    const bytes = getTransactionDecoder().decode(getBase64Encoder().encode(base64)).messageBytes
    msg = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(bytes))
  } catch {
    return "it can't be read"
  }
  if (msg.feePayer.address !== signer) return "it isn't paid by your wallet"

  const escrow = []
  for (const ix of msg.instructions) {
    if (ix.programAddress === COMPUTE_BUDGET) continue
    if (ix.programAddress !== program) return `it calls another program (${ix.programAddress})`
    escrow.push(ix)
  }
  if (escrow.length !== 1) return "it doesn't hold exactly one Samite instruction"

  let p: ReturnType<typeof parseSamiteEscrowInstruction>
  try {
    p = parseSamiteEscrowInstruction(escrow[0] as Parameters<typeof parseSamiteEscrowInstruction>[0])
  } catch {
    return "its Samite instruction can't be read"
  }
  if (p.instructionType !== KIND[e.action]) return `it isn't the ${e.action} you asked for`
  const accounts = p.accounts as unknown as Record<string, { address: Address } | undefined>
  if (accounts.job?.address !== e.job) return "it acts on a different job"
  if (accounts[SIGNER[e.action]]?.address !== signer) return "it isn't signed as your wallet"

  if (e.action === "post" && p.instructionType === I.PostJob) {
    if (p.data.reward !== e.reward) return "it locks a different amount than shown"
    if (hex(p.data.specHash) !== e.specHash) return "it posts a different spec than this page stored"
  }
  if ((e.action === "accept" || e.action === "reject") && accounts.machine?.address !== e.machine)
    return "it names a different machine than the chain"
  if (e.action === "reject" && p.instructionType === I.RejectDelivery && hex(p.data.reasonHash) !== e.reasonHash)
    return "its reason is not the one you wrote"
  return null
}
