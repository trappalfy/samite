// Fund the local wallets, give them USDC accounts, and initialise the escrow config (fee 250 bps, min 1 USDC).
import {
  address,
  airdropFactory,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
  type Address,
} from "@solana/kit"
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token"
import { LIMITS, USDC_MINT } from "@samite/config/solana"
import {
  CONFIG_ACCOUNT_BYTES,
  eventCpiAccounts,
  fetchMaybeConfig,
  findConfigPda,
  getInitializeConfigInstructionAsync,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
} from "@samite/program-client"
import { loadSigners, type Role } from "./keys"
import type { Client } from "./tx"

const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111")
const MINT = address(USDC_MINT)

export async function usdcAccount(owner: Address) {
  const [ata] = await findAssociatedTokenPda({ owner, mint: MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS })
  return ata
}

/** Starting balances in USDC base units. */
export const STARTING_USDC: Partial<Record<Role, bigint>> = {
  poster: 10_000_000_000n, // 10,000 USDC
  machine: 100_000_000n, // 100 USDC
  machine2: 100_000_000n,
}

/** `initConfig: false` leaves the program uninitialized, to rehearse `scripts/mainnet/initialize-config.ts` locally. */
export async function bootstrap(client: Client, { initConfig = true } = {}) {
  const s = await loadSigners()
  const airdrop = airdropFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions })
  for (const role of Object.keys(s) as Role[])
    await airdrop({ recipientAddress: s[role].address, lamports: lamports(20_000_000_000n), commitment: "confirmed" })

  // USDC accounts for everyone who holds or receives USDC, and the starting balances
  const ixs = []
  for (const role of ["treasury", "poster", "machine", "machine2"] as Role[]) {
    ixs.push(
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: s.authority,
        owner: s[role].address,
        mint: MINT,
      }),
    )
  }
  await client.send(s.authority, ixs)
  // top up to the starting balance (not add to it), so bootstrapping twice leaves the same balances
  const topUps = []
  for (const role of Object.keys(STARTING_USDC) as Role[]) {
    const token = await usdcAccount(s[role].address)
    const { value } = await client.rpc.getTokenAccountBalance(token, { commitment: "confirmed" }).send()
    const want = STARTING_USDC[role]!
    if (BigInt(value.amount) < want)
      topUps.push(
        getMintToInstruction({ mint: MINT, token, mintAuthority: s.authority, amount: want - BigInt(value.amount) }),
      )
  }
  if (topUps.length) await client.send(s.authority, topUps)

  const [config] = await findConfigPda()
  if (!initConfig) return s
  if (!(await fetchMaybeConfig(client.rpc, config)).exists) {
    const [programData] = await getProgramDerivedAddress({
      programAddress: LOADER,
      seeds: [getAddressEncoder().encode(SAMITE_ESCROW_PROGRAM_ADDRESS)],
    })
    const init = await getInitializeConfigInstructionAsync({
      authority: s.authority,
      treasuryOwner: s.treasury.address,
      treasury: await usdcAccount(s.treasury.address),
      programData,
      feeBps: LIMITS.feeBps,
      minReward: LIMITS.minRewardBaseUnits,
      ...(await eventCpiAccounts()),
    })
    await client.send(s.authority, [init])
  }
  // the mainnet script reads Config rent from CONFIG_ACCOUNT_BYTES; keep it equal to what the program creates
  const created = await client.rpc.getAccountInfo(config, { encoding: "base64", commitment: "confirmed" }).send()
  if (created.value?.space !== BigInt(CONFIG_ACCOUNT_BYTES))
    throw new Error(`Config is ${created.value?.space} bytes; CONFIG_ACCOUNT_BYTES says ${CONFIG_ACCOUNT_BYTES}`)
  return s
}
