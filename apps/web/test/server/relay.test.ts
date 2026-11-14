// /tx/send relays only the escrow program's transactions (§6.1: convenience only, not a general relay). Every
// instruction must call the escrow program, or a program a wallet adds to what it signs: compute budget (a priority
// fee) and Lighthouse (Phantom's balance assertions; the owner's first post from Phantom was refused without it).
import { describe, expect, it } from "vitest"
import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from "@solana/kit"
import { SAMITE_ESCROW_PROGRAM_ADDRESS } from "@samite/program-client"
import type { Server } from "../../lib/server/context"
import { relay } from "../../lib/server/tx"

const SYSTEM = address("11111111111111111111111111111111")
const COMPUTE_BUDGET = address("ComputeBudget111111111111111111111111111111")
const LIGHTHOUSE = address("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95")
const sent: string[] = []
const s = {
  program: SAMITE_ESCROW_PROGRAM_ADDRESS,
  rpc: { sendTransaction: (tx: string) => ({ send: async () => (sent.push(tx), "sig") }) },
} as unknown as Server

async function wire(ixs: Instruction[]) {
  const payer = await generateKeyPairSigner()
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"), lastValidBlockHeight: 1n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(ixs, m),
  )
  return getBase64EncodedWireTransaction(compileTransaction(msg))
}
const ix = (programAddress: string, accounts: string[] = []): Instruction => ({
  programAddress: address(programAddress),
  accounts: accounts.map((a) => ({ address: address(a), role: 0 })),
  data: new Uint8Array([1]),
})

describe("the /tx/send relay", () => {
  it("sends an escrow transaction, with or without a compute-budget instruction", async () => {
    await expect(relay(s, await wire([ix(SAMITE_ESCROW_PROGRAM_ADDRESS)]))).resolves.toBe("sig")
    await expect(relay(s, await wire([ix(COMPUTE_BUDGET), ix(SAMITE_ESCROW_PROGRAM_ADDRESS)]))).resolves.toBe("sig")
    expect(sent).toHaveLength(2)
  })

  it("sends what Phantom returns: the escrow instruction with a priority fee and Lighthouse assertions added", async () => {
    await expect(
      relay(s, await wire([ix(COMPUTE_BUDGET), ix(COMPUTE_BUDGET), ix(SAMITE_ESCROW_PROGRAM_ADDRESS), ix(LIGHTHOUSE)])),
    ).resolves.toBe("sig")
    sent.pop()
  })

  it("refuses a transaction that only mentions the program as an account", async () => {
    await expect(relay(s, await wire([ix(SYSTEM, [SAMITE_ESCROW_PROGRAM_ADDRESS])]))).rejects.toMatchObject({
      code: "tx_invalid",
    })
  })

  it("refuses an escrow transaction with any other program's instruction in it, and names that program", async () => {
    await expect(
      relay(s, await wire([ix(SAMITE_ESCROW_PROGRAM_ADDRESS), ix(LIGHTHOUSE), ix(SYSTEM)])),
    ).rejects.toMatchObject({
      code: "tx_invalid",
      message: expect.stringContaining(`this one also calls ${SYSTEM}`),
    })
  })

  it("refuses a transaction with only the programs a wallet adds", async () => {
    await expect(relay(s, await wire([ix(COMPUTE_BUDGET), ix(LIGHTHOUSE)]))).rejects.toMatchObject({
      code: "tx_invalid",
    })
  })

  it("refuses a transaction with only a compute-budget instruction", async () => {
    await expect(relay(s, await wire([ix(COMPUTE_BUDGET)]))).rejects.toMatchObject({ code: "tx_invalid" })
    expect(sent).toHaveLength(2)
  })
})
