// The local USDC mint (CLAUDE.md §3.2): the real address, 6 decimals, classic SPL Token owner, a local mint authority.
// solana-test-validator loads it with `--account <USDC_MINT> <file>`; the program never knows the difference.
import { getBase64Decoder, none, some, type Address } from "@solana/kit"
import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token"
import { USDC_DECIMALS, USDC_MINT } from "@samite/config/solana"

/** Rent-exempt minimum for an 82-byte account at the default rent (validator default). */
const MINT_RENT = 1_461_600

export function usdcMintAccount(mintAuthority: Address) {
  const data = getMintEncoder().encode({
    mintAuthority: some(mintAuthority),
    supply: 0n,
    decimals: USDC_DECIMALS,
    isInitialized: true,
    freezeAuthority: none(),
  })
  return {
    pubkey: USDC_MINT,
    account: {
      lamports: MINT_RENT,
      data: [getBase64Decoder().decode(data), "base64"] as [string, "base64"],
      owner: TOKEN_PROGRAM_ADDRESS,
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  }
}
