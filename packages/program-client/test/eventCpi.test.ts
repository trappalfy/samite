import { getProgramDerivedAddress, getUtf8Encoder } from "@solana/kit"
import { describe, expect, it } from "vitest"
import { eventCpiAccounts, SAMITE_ESCROW_PROGRAM_ADDRESS } from "../src"

// Anchor's #[event_cpi] adds two accounts: the event authority PDA ["__event_authority"] and the program itself.
describe("eventCpiAccounts", () => {
  it("derives the event authority from the program address", async () => {
    const { eventAuthority, program } = await eventCpiAccounts()
    const [expected] = await getProgramDerivedAddress({
      programAddress: SAMITE_ESCROW_PROGRAM_ADDRESS,
      seeds: [getUtf8Encoder().encode("__event_authority")],
    })
    expect(eventAuthority).toBe(expected)
    expect(program).toBe(SAMITE_ESCROW_PROGRAM_ADDRESS)
  })

  it("follows a program deployed at another address", async () => {
    const other = "11111111111111111111111111111112" as typeof SAMITE_ESCROW_PROGRAM_ADDRESS
    const { program, eventAuthority } = await eventCpiAccounts(other)
    expect(program).toBe(other)
    expect(eventAuthority).not.toBe((await eventCpiAccounts()).eventAuthority)
  })
})
