// Hand-written helpers next to the generated client (src/generated is never edited).
import { getProgramDerivedAddress, getUtf8Encoder, type Address } from "@solana/kit"
import { SAMITE_ESCROW_PROGRAM_ADDRESS } from "./generated"

/**
 * The two accounts Anchor's `#[event_cpi]` appends to every instruction that emits events:
 * the event authority PDA (seeds ["__event_authority"]) and the program itself. The IDL doesn't carry their seeds,
 * so the generated instructions ask for them.
 */
export async function eventCpiAccounts(programAddress: Address = SAMITE_ESCROW_PROGRAM_ADDRESS) {
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress,
    seeds: [getUtf8Encoder().encode("__event_authority")],
  })
  return { eventAuthority, program: programAddress }
}
