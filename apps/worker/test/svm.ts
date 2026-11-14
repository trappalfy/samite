// A LiteSVM chain for the keeper tests: the built program, USDC at the real mint address, a Config written directly,
// funded wallets, a clock we set. Every transaction that lands is also fed to the indexer, so the index follows the
// chain exactly as it would over the RPC.
import { existsSync } from "node:fs"
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  lamports,
  none,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  some,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit"
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintEncoder,
  getMintToInstruction,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token"
import { Clock, FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm"
import { LIMITS, USDC_DECIMALS, USDC_MINT } from "@samite/config/solana"
import { createDb, type Db } from "@samite/db"
import { migrate } from "@samite/db/migrate"
import { sha256 } from "@samite/formats"
import {
  actions,
  claimPolicy,
  CONFIG_ACCOUNT_BYTES,
  decodeEscrowEvents,
  findConfigPda,
  getConfigEncoder,
  getJobDecoder,
  SAMITE_ESCROW_PROGRAM_ADDRESS,
  type EscrowTransaction,
} from "@samite/program-client"
import { applyTransaction } from "../src/indexer/apply"
import { toChainJob } from "../src/keeper/chain"
import type { KeeperChain } from "../src/keeper/keeper"

export const SO = new URL("../../../target/deploy/samite_escrow.so", import.meta.url).pathname
export const hasProgram = existsSync(SO)
export const MINT = address(USDC_MINT)
export const ctx = { usdcMint: MINT }
export const T0 = 1_800_000_000n
const b58 = getBase58Decoder()

export type Harness = Awaited<ReturnType<typeof harness>>

export async function harness() {
  const svm = new LiteSVM()
  svm.addProgramFromFile(SAMITE_ESCROW_PROGRAM_ADDRESS, SO)
  let slot = 100n
  const setTime = (unix: bigint) => {
    slot += 1n
    svm.setClock(new Clock(slot, T0, 0n, 0n, unix))
    svm.expireBlockhash()
  }
  setTime(T0)

  const [authority, poster, machine, treasuryOwner, keeper] = await Promise.all(
    Array.from({ length: 5 }, () => generateKeyPairSigner()),
  )
  for (const k of [authority!, poster!, machine!, treasuryOwner!, keeper!])
    svm.airdrop(k.address, lamports(10_000_000_000n))
  const mintData = getMintEncoder().encode({
    mintAuthority: some(authority!.address),
    supply: 0n,
    decimals: USDC_DECIMALS,
    isInitialized: true,
    freezeAuthority: none(),
  })
  svm.setAccount({
    address: MINT,
    programAddress: TOKEN_PROGRAM_ADDRESS,
    lamports: lamports(1_461_600n),
    executable: false,
    data: Uint8Array.from(mintData),
    space: BigInt(mintData.length),
  })

  const db: Db = await createDb("memory://")
  await migrate(db)

  const ata = async (owner: Address) =>
    (await findAssociatedTokenPda({ owner, mint: MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]

  /** Sends, feeds the indexer, throws with the program's logs if it fails. */
  async function send(payer: TransactionSigner, ixs: Instruction[]) {
    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
      (m) => appendTransactionMessageInstructions(ixs, m),
      (m) => signTransactionMessageWithSigners(m),
    )
    const r = svm.sendTransaction(tx)
    if (r instanceof FailedTransactionMetadata) throw new Error(`${r.err()}\n${r.meta().logs().join("\n")}`)
    const sig = b58.decode((r as TransactionMetadata).signature())
    const keys = getCompiledTransactionMessageDecoder().decode(tx.messageBytes).staticAccounts
    const etx: EscrowTransaction = {
      slot,
      blockTime: null,
      meta: {
        err: null,
        innerInstructions: r.innerInstructions().map((inner, index) => ({
          index,
          instructions: inner.map((ii) => ({
            programIdIndex: ii.instruction().programIdIndex(),
            data: b58.decode(ii.instruction().data()),
          })),
        })),
      },
      transaction: { message: { accountKeys: keys }, signatures: [sig] },
    }
    await applyTransaction(db, { sig, slot, events: decodeEscrowEvents(etx) }, { cursor: true })
    return sig
  }

  // USDC accounts and balances, and a Config as initialize_config would write it (fee 250, min 1 USDC)
  await send(authority!, [
    ...(await Promise.all(
      [poster, machine, treasuryOwner].map((k) =>
        getCreateAssociatedTokenIdempotentInstructionAsync({ payer: authority!, owner: k!.address, mint: MINT }),
      ),
    )),
    getMintToInstruction({
      mint: MINT,
      token: await ata(poster!.address),
      mintAuthority: authority!,
      amount: 1_000_000_000n,
    }),
  ])
  const treasury = await ata(treasuryOwner!.address)
  const [configPda, bump] = await findConfigPda()
  const config = getConfigEncoder().encode({
    admin: authority!.address,
    treasury,
    usdcMint: MINT,
    feeBps: LIMITS.feeBps,
    minReward: LIMITS.minRewardBaseUnits,
    paused: false,
    bump,
    pendingAdmin: none(),
    treasuryOwner: treasuryOwner!.address,
  })
  // 8 + Config::INIT_SPACE (Option<Pubkey> sized at 33 whatever it holds)
  const data = new Uint8Array(CONFIG_ACCOUNT_BYTES)
  data.set(config)
  svm.setAccount({
    address: configPda,
    programAddress: SAMITE_ESCROW_PROGRAM_ADDRESS,
    lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(CONFIG_ACCOUNT_BYTES))),
    executable: false,
    data,
    space: BigInt(CONFIG_ACCOUNT_BYTES),
  })

  const usdc = (owner: Address) => {
    return ata(owner).then((a) => {
      const acc = svm.getAccount(a)
      return acc.exists ? getTokenDecoder().decode(acc.data).amount : null
    })
  }
  const now = () => svm.getClock().unixTimestamp
  const job = (pda: Address) => {
    const a = svm.getAccount(pda)
    return a.exists ? getJobDecoder().decode(a.data) : null
  }

  const chain: KeeperChain = {
    now: async () => now(),
    job: async (pda) => {
      const j = job(pda)
      return j ? toChainJob(j) : null
    },
    exists: async (a) => svm.getAccount(a).exists,
    treasury: async () => treasury,
    send: (ixs) => send(keeper!, ixs),
  }

  async function post(o: { reward?: bigint; deadlineIn?: bigint; reviewWindow?: bigint; claimWindow?: bigint } = {}) {
    const p = await actions.postJob(ctx, {
      poster: poster!,
      reward: o.reward ?? 80_000_000n,
      deadline: now() + (o.deadlineIn ?? 86_400n),
      reviewWindow: o.reviewWindow ?? 3_600n,
      claimWindow: o.claimWindow ?? o.deadlineIn ?? 86_400n, // no 0 since Nov 13: the full term by default
      policy: claimPolicy("Any"),
      specHash: sha256(new TextEncoder().encode(`spec ${now()} ${Math.random()}`)),
    })
    await send(poster!, [p.instruction])
    return p.job
  }
  const claim = async (pda: Address, m: KeyPairSigner = machine!) =>
    send(m, [await actions.claimJob(ctx, { machine: m, job: pda })])
  const deliver = async (
    pda: Address,
    m: KeyPairSigner = machine!,
    hash: ReadonlyUint8Array = sha256(new TextEncoder().encode(pda)),
  ) => send(m, [await actions.submitDelivery(ctx, { machine: m, job: pda, deliveryHash: hash })])

  return {
    svm,
    db,
    chain,
    send,
    setTime,
    now,
    job,
    usdc,
    ata,
    post,
    claim,
    deliver,
    treasury,
    poster: poster!,
    machine: machine!,
    keeper: keeper!,
    treasuryOwner: treasuryOwner!,
    close: () => db.$client.close?.(),
  }
}
