import { describe, expect, it } from "vitest"
import { anchorMessage, explainFailure, formatSol } from "../../lib/server/preflight"

// What a post of 1 USDC needs on mainnet (rent read live, Nov 15): the job's and its escrow's rent, the minimum every
// wallet keeps (a 0-byte account's rent), one signature and the margin for a wallet's priority fee.
const postNeed = {
  rent: 3_535_680n + 1_488_440n,
  rentComesBack: true,
  usdc: 1_000_000n,
  reserve: 650_240n,
  fees: 105_000n,
}
const feeOnly = { rent: 0n, rentComesBack: false, usdc: 0n, reserve: 650_240n, fees: 105_000n }

describe("explainFailure", () => {
  it("names the SOL that is missing, the wallet's own minimum, and that the rent comes back (the owner's Phantom, Nov 14)", () => {
    // simulated on mainnet: 9PeM…HNcM held 0.005463116 SOL and 5.04 USDC; Phantom blocked the post. The wallet had more
    // than the rent and the fee: what was missing was the minimum it must keep (InsufficientFundsForRent, account 0)
    const e = explainFailure({ err: { InsufficientFundsForRent: { account_index: 0n } }, logs: [] }, postNeed, {
      lamports: 5_463_116n,
      usdc: 5_040_001n,
    })
    expect(e.code).toBe("insufficient_funds")
    expect(e.status).toBe(409)
    expect(e.message).toBe(
      "Your wallet has 0.005463116 SOL; this needs about 0.00577936 SOL: 0.00502412 account rent, which comes back when the job closes, 0.00065024 that Solana requires every wallet to keep, and about 0.000105 for network fees. Add a little SOL and try again. Nothing was signed.",
    )
    expect(e.details).toEqual({ asset: "SOL", need_lamports: "5779360", have_lamports: "5463116" })
  })

  it("blames SOL on the fee errors and the system program's log even when the balance looks enough", () => {
    for (const err of ["InsufficientFundsForFee", "AccountNotFound"])
      expect(explainFailure({ err, logs: [] }, postNeed, { lamports: 10n ** 9n, usdc: 10n ** 9n }).code).toBe(
        "insufficient_funds",
      )
    const e = explainFailure(
      { err: { InstructionError: [0, { Custom: 1 }] }, logs: ["Transfer: insufficient lamports 100, need 2039280"] },
      feeOnly,
      { lamports: 10_000n, usdc: 0n },
    )
    expect(e.message).toContain(
      "this needs about 0.00075524 SOL: 0.00065024 that Solana requires every wallet to keep, and about 0.000105 for network fees.",
    )
  })

  it("names the USDC that is missing, or that the wallet has none", () => {
    const short = explainFailure(
      { err: { InstructionError: [0, { Custom: 1 }] }, logs: ["Program log: Error: insufficient funds"] },
      postNeed,
      { lamports: 10n ** 9n, usdc: 400_000n },
    )
    expect(short.code).toBe("insufficient_funds")
    expect(short.message).toBe(
      "Your wallet has 0.40 USDC; this locks 1.00 USDC. Add USDC and try again. Nothing was signed.",
    )
    const none = explainFailure(
      {
        err: { InstructionError: [0, { Custom: 3012 }] },
        logs: ["Program log: AnchorError caused by account: poster_usdc. Error Code: AccountNotInitialized."],
      },
      postNeed,
      { lamports: 10n ** 9n, usdc: null },
    )
    expect(none.message).toMatch(/^Your wallet has no USDC yet; this locks 1.00 USDC/)
  })

  it("passes on the program's own reason for anything else", () => {
    const e = explainFailure(
      {
        err: { InstructionError: [0, { Custom: 6004 }] },
        logs: [
          "Program log: AnchorError thrown in programs/samite_escrow/src/instructions/claim_job.rs:40. Error Code: DeadlinePassed. Error Number: 6004. Error Message: The deadline has passed.",
        ],
      },
      feeOnly,
      { lamports: 10n ** 9n, usdc: 0n },
    )
    expect(e.code).toBe("tx_would_fail")
    expect(e.message).toBe("This transaction would fail on-chain: The deadline has passed. Nothing was signed.")
    const bare = explainFailure({ err: "BlockhashNotFound", logs: null }, feeOnly, { lamports: 10n ** 9n, usdc: 0n })
    expect(bare.message).toBe("This transaction would fail on-chain (BlockhashNotFound). Nothing was signed.")
    expect(bare.details).toEqual({ err: "BlockhashNotFound" })
  })
})

describe("formatSol", () => {
  it("is exact and drops trailing zeros", () => {
    expect(formatSol(5_463_116n)).toBe("0.005463116")
    expect(formatSol(5_580_000n)).toBe("0.00558")
    expect(formatSol(2_000_000_000n)).toBe("2")
    expect(formatSol(0n)).toBe("0")
  })
})

describe("anchorMessage", () => {
  it("takes the last Error Message line, without its full stop", () => {
    expect(anchorMessage(["a", "Program log: AnchorError … Error Message: Claim window out of range."])).toBe(
      "Claim window out of range",
    )
    expect(anchorMessage(null)).toBeNull()
  })
})
