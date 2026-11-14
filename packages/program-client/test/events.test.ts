import { address, getBase58Decoder, type Address, type ReadonlyUint8Array } from "@solana/kit"
import { describe, expect, it } from "vitest"
import {
  decodeEscrowEvents,
  EVENT_IX_TAG,
  getJobClaimedEventEncoder,
  getJobPaidEventEncoder,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
  type EscrowTransaction,
} from "../src"

// Events come from Anchor's emit_cpi: an inner instruction to the program itself whose data is
// EVENT_IX_TAG (sha256("anchor:event")[..8], LE) + the event's discriminator + borsh. Only those count.
const b58 = (bytes: ReadonlyUint8Array) => getBase58Decoder().decode(bytes)
const join = (...parts: ReadonlyUint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]))

const JOB = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
const MACHINE = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
const POSTER = address("SysvarRent111111111111111111111111111111111")
const OTHER = address("11111111111111111111111111111112")
const claimed = getJobClaimedEventEncoder().encode({ job: JOB, machine: MACHINE, claimedAt: 1_800_000_000n })
const paid = getJobPaidEventEncoder().encode({
  job: JOB,
  poster: POSTER,
  machine: MACHINE,
  reward: 80_000_000n,
  toMachine: 78_000_000n,
  fee: 2_000_000n,
  auto: false,
  at: 1_800_000_100n,
})

function tx(
  inner: { index: number; instructions: { programIdIndex: number; data: string }[] }[],
  err: unknown = null,
  keys: Address[] = [POSTER, SAMITE_ESCROW_PROGRAM_ADDRESS, OTHER],
): EscrowTransaction {
  return {
    slot: 42n,
    blockTime: null,
    meta: { err, innerInstructions: inner, loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { accountKeys: keys }, signatures: ["sig1"] },
  }
}

describe("decodeEscrowEvents", () => {
  it("reads the program's event CPIs in order, across top-level instructions", () => {
    const events = decodeEscrowEvents(
      tx([
        { index: 1, instructions: [{ programIdIndex: 1, data: b58(join(EVENT_IX_TAG, paid)) }] },
        { index: 0, instructions: [{ programIdIndex: 1, data: b58(join(EVENT_IX_TAG, claimed)) }] },
      ]),
    )
    expect(events.map((e) => e.name)).toEqual(["JobClaimed", "JobPaid"])
    expect(events[0]).toMatchObject({
      ix: 0,
      name: "JobClaimed",
      data: { job: JOB, machine: MACHINE, claimedAt: 1_800_000_000n },
    })
    expect(events[1]).toMatchObject({
      ix: 1,
      name: "JobPaid",
      data: { toMachine: 78_000_000n, fee: 2_000_000n, auto: false },
    })
  })

  it("ignores look-alike events from another program and the program's own non-event instructions", () => {
    const events = decodeEscrowEvents(
      tx([
        {
          index: 0,
          instructions: [
            { programIdIndex: 2, data: b58(join(EVENT_IX_TAG, paid)) }, // another program, same bytes
            { programIdIndex: 1, data: b58(paid) }, // the program, but not an event CPI
            { programIdIndex: 1, data: b58(join(EVENT_IX_TAG, claimed)) },
          ],
        },
      ]),
    )
    expect(events.map((e) => e.name)).toEqual(["JobClaimed"])
  })

  it("finds the program among addresses loaded from a lookup table", () => {
    const t = tx([{ index: 0, instructions: [{ programIdIndex: 2, data: b58(join(EVENT_IX_TAG, claimed)) }] }], null, [
      POSTER,
      OTHER,
    ])
    t.meta!.loadedAddresses = { writable: [], readonly: [SAMITE_ESCROW_PROGRAM_ADDRESS] }
    expect(decodeEscrowEvents(t).map((e) => e.name)).toEqual(["JobClaimed"])
  })

  it("returns nothing for a failed transaction: its events were rolled back", () => {
    expect(
      decodeEscrowEvents(
        tx([{ index: 0, instructions: [{ programIdIndex: 1, data: b58(join(EVENT_IX_TAG, claimed)) }] }], {
          InstructionError: [0, "Custom"],
        }),
      ),
    ).toEqual([])
  })

  it("throws on an event CPI it cannot decode rather than skip it silently", () => {
    expect(() =>
      decodeEscrowEvents(
        tx([{ index: 0, instructions: [{ programIdIndex: 1, data: b58(join(EVENT_IX_TAG, new Uint8Array(8))) }] }]),
      ),
    ).toThrow()
  })
})
