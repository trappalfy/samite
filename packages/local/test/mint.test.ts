import { getAddressEncoder, getBase64Encoder, type Address } from "@solana/kit"
import { describe, expect, it } from "vitest"
import { USDC_MINT } from "@samite/config/solana"
import { usdcMintAccount } from "../src/mint"

// the escrow program's public address as a stand-in mint authority, not a key
const AUTH = "AcTtHioeudEDQuaW6WaL5auXC2rv3jPNoNbPxPB7pHM9" as Address // gitleaks:allow

// §3.2: the local mint sits at the real USDC address, same decimals and owner, with a test mint authority.
describe("usdcMintAccount", () => {
  const acc = usdcMintAccount(AUTH)
  const data = Uint8Array.from(getBase64Encoder().encode(acc.account.data[0]))

  it("lives at the mainnet USDC address and is owned by the classic SPL Token program", () => {
    expect(acc.pubkey).toBe(USDC_MINT)
    expect(acc.account.owner).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
    expect(acc.account.executable).toBe(false)
    expect(acc.account.data[1]).toBe("base64")
  })

  it("is an initialised 6-decimal mint with our authority and no freeze authority (82-byte SPL layout)", () => {
    expect(data.length).toBe(82)
    expect(Array.from(data.slice(0, 4))).toEqual([1, 0, 0, 0]) // COption::Some
    expect(Array.from(data.slice(4, 36))).toEqual(Array.from(getAddressEncoder().encode(AUTH)))
    expect(Array.from(data.slice(36, 44))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]) // supply 0
    expect(data[44]).toBe(6) // decimals
    expect(data[45]).toBe(1) // initialised
    expect(Array.from(data.slice(46, 50))).toEqual([0, 0, 0, 0]) // freeze authority: None
  })

  it("is rent-exempt for 82 bytes", () => {
    expect(acc.account.lamports).toBe(1_461_600)
    expect(acc.account.space).toBe(82)
  })
})
