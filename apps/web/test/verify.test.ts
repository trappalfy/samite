// What the browser checks before the wallet signs (review R1): transactions built with the same actions layer the API
// uses pass; anything else a compromised API could hand over is refused, with the reason.
import { describe, expect, it } from "vitest"
import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit"
import { getTransferInstruction } from "@solana-program/token"
import { USDC_MINT } from "@samite/config/solana"
import { actions, claimPolicy, SAMITE_ESCROW_PROGRAM_ADDRESS } from "@samite/program-client"
import { verifyTransaction } from "../lib/wallet/verify"

// real, valid addresses with no meaning here
const ME = address("8qQ1BybTXdJSHqW6s6RZwR982oAGbqKmEmgpVWKVng3c")
const MACHINE = address("9B6oPeqPKzRQXK2W2fJEUgRDxFC4PYrRthseKW8BeJde")
const OTHER = address("8ep1fsm4r1T2cFxdy2oS4tDbn1teZbtHoKEYYUjpSvf4")
const TREASURY = address("CuG4a3diSydGLGFZSUHnG7ifa3ZwdZ455r7X1FYhRReu")
const COMPUTE_BUDGET = address("ComputeBudget111111111111111111111111111111")
const ctx = { usdcMint: address(USDC_MINT) }
const me = createNoopSigner(ME)
const SPEC = new Uint8Array(32).fill(0xab)
const SPEC_HEX = "ab".repeat(32)

function wire(ixs: Instruction[], payer: Address = ME) {
  return getBase64EncodedWireTransaction(
    compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(createNoopSigner(payer), m),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"), lastValidBlockHeight: 1n },
            m,
          ),
        (m) => appendTransactionMessageInstructions(ixs, m),
      ),
    ),
  )
}
const post = (reward = 80_000_000n, spec = SPEC) =>
  actions.postJob(ctx, {
    poster: me,
    reward,
    deadline: 2_000_000_000n,
    reviewWindow: 172_800n,
    claimWindow: 86_400n,
    policy: claimPolicy("Any"),
    specHash: spec,
  })
const budget: Instruction = { programAddress: COMPUTE_BUDGET, data: new Uint8Array([3, 1, 0, 0, 0, 0, 0, 0, 0]) }
// the theft a compromised API would try: move the wallet's USDC elsewhere
const drain = getTransferInstruction({ source: TREASURY, destination: OTHER, authority: me, amount: 1_000_000_000n })

describe("what the browser signs", () => {
  it("passes a post that locks what the page shows, with or without a priority fee", async () => {
    const p = await post()
    const want = { action: "post" as const, job: p.job, reward: 80_000_000n, specHash: SPEC_HEX }
    expect(verifyTransaction(wire([p.instruction]), want, ME)).toBeNull()
    expect(verifyTransaction(wire([budget, p.instruction]), want, ME)).toBeNull()
  })

  it("refuses a post with another amount, another spec, or a token transfer slipped in", async () => {
    const p = await post()
    const want = { action: "post" as const, job: p.job, reward: 80_000_000n, specHash: SPEC_HEX }
    const more = await post(90_000_000n)
    expect(verifyTransaction(wire([more.instruction]), { ...want, job: more.job }, ME)).toBe(
      "it locks a different amount than shown",
    )
    const other = await post(80_000_000n, new Uint8Array(32).fill(1))
    expect(verifyTransaction(wire([other.instruction]), { ...want, job: other.job }, ME)).toBe(
      "it posts a different spec than this page stored",
    )
    expect(verifyTransaction(wire([p.instruction, drain]), want, ME)).toMatch(/^it calls another program/)
    expect(verifyTransaction(wire([drain]), want, ME)).toMatch(/^it calls another program/)
  })

  it("refuses another action, another job, another payer or signer, or two Samite instructions", async () => {
    const job = (await post()).job
    const cancel = await actions.cancelJob(ctx, { poster: me, job })
    expect(verifyTransaction(wire([cancel]), { action: "cancel", job }, ME)).toBeNull()
    expect(verifyTransaction(wire([cancel]), { action: "unclaim", job }, ME)).toBe("it isn't the unclaim you asked for")
    expect(verifyTransaction(wire([cancel]), { action: "cancel", job: OTHER }, ME)).toBe("it acts on a different job")
    expect(verifyTransaction(wire([cancel], OTHER), { action: "cancel", job }, ME)).toBe("it isn't paid by your wallet")
    const theirs = await actions.cancelJob(ctx, { poster: createNoopSigner(OTHER), job })
    expect(verifyTransaction(wire([theirs]), { action: "cancel", job }, ME)).toBe("it isn't signed as your wallet")
    expect(verifyTransaction(wire([cancel, cancel]), { action: "cancel", job }, ME)).toBe(
      "it doesn't hold exactly one Samite instruction",
    )
    expect(verifyTransaction("not a transaction", { action: "cancel", job }, ME)).toBe("it can't be read")
  })

  it("checks the machine of an accept and the reason of a reject", async () => {
    const job = (await post()).job
    const accept = await actions.acceptDelivery(ctx, { poster: me, job, machine: MACHINE, treasury: TREASURY })
    expect(verifyTransaction(wire([accept]), { action: "accept", job, machine: MACHINE }, ME)).toBeNull()
    expect(verifyTransaction(wire([accept]), { action: "accept", job, machine: OTHER }, ME)).toBe(
      "it names a different machine than the chain",
    )
    const reject = await actions.rejectDelivery(ctx, { poster: me, job, machine: MACHINE, reasonHash: SPEC })
    const want = { action: "reject" as const, job, machine: MACHINE, reasonHash: SPEC_HEX }
    expect(verifyTransaction(wire([reject]), want, ME)).toBeNull()
    expect(verifyTransaction(wire([reject]), { ...want, reasonHash: "00".repeat(32) }, ME)).toBe(
      "its reason is not the one you wrote",
    )
  })

  it("refuses an instruction of the right program from the wrong deployment", async () => {
    const p = await post()
    const want = { action: "post" as const, job: p.job, reward: 80_000_000n, specHash: SPEC_HEX }
    expect(verifyTransaction(wire([p.instruction]), want, ME, OTHER)).toMatch(/^it calls another program/)
    expect(SAMITE_ESCROW_PROGRAM_ADDRESS).toBe(p.instruction.programAddress)
  })
})
