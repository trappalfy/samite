// Backfill + polling (CLAUDE.md §7.2): every signature for the program newer than the cursor, oldest first, each
// transaction fetched, decoded and applied with the cursor in one database transaction. A crash anywhere leaves the
// cursor at the last applied transaction, so the next run continues from there; a lost cursor re-reads from the
// start and changes nothing (applying is idempotent).
import { eq } from "drizzle-orm"
import type { Address, Commitment, GetSignaturesForAddressApi, GetTransactionApi, Rpc, Signature } from "@solana/kit"
import { schema, type Db } from "@samite/db"
import { decodeEscrowEvents, type EscrowTransaction } from "@samite/program-client"
import { applyTransaction, CURSOR_KEY } from "./apply"

export type IndexerRpc = Rpc<GetSignaturesForAddressApi & GetTransactionApi>

export type SyncOptions = {
  program: Address
  /** "confirmed" by default: the board updates within a second or two; a confirmed block is not rolled back in practice. */
  commitment?: Exclude<Commitment, "processed">
  pageSize?: number
  log?: (line: Record<string, unknown>) => void
}

export type SyncResult = { applied: number; skipped: number; pending: boolean }

export async function syncOnce(db: Db, rpc: IndexerRpc, o: SyncOptions): Promise<SyncResult> {
  const commitment = o.commitment ?? "confirmed"
  const pageSize = o.pageSize ?? 1000
  const [cursor] = await db.select().from(schema.indexerState).where(eq(schema.indexerState.key, CURSOR_KEY))
  const until = (cursor?.lastSig ?? undefined) as Signature | undefined

  // newest first from the RPC, paged back to the cursor. If the RPC no longer knows the cursor's transaction (a
  // purged ledger, a pruned provider), page back to the cursor's slot instead and re-apply from there: applying is
  // idempotent, so the transactions already in the index are skipped.
  const found: { signature: Signature; slot: bigint; err: unknown }[] = []
  let before: Signature | undefined
  let bySlot = false
  for (;;) {
    let page
    try {
      page = await rpc
        .getSignaturesForAddress(o.program, { until: bySlot ? undefined : until, before, limit: pageSize, commitment })
        .send()
    } catch (e) {
      if (!until || bySlot || !/not found/i.test(e instanceof Error ? e.message : String(e))) throw e
      o.log?.({
        msg: "cursor transaction unknown to the RPC; re-reading from its slot",
        slot: cursor!.lastSlot.toString(),
      })
      bySlot = true
      before = undefined
      found.length = 0
      continue
    }
    const keep = bySlot ? page.filter((p) => p.slot >= cursor!.lastSlot) : page
    found.push(...keep)
    if (bySlot && page.length < pageSize && keep.length === page.length && (page.at(-1)?.slot ?? 0n) > cursor!.lastSlot)
      // the RPC's history starts after the cursor: what happened in between can't be read from this RPC
      o.log?.({
        msg: "gap: the RPC has no history between the cursor and its oldest transaction; use an archival RPC",
        from: cursor!.lastSlot.toString(),
        to: page.at(-1)!.slot.toString(),
      })
    if (page.length < pageSize || keep.length < page.length) break
    before = page.at(-1)!.signature
  }

  const result: SyncResult = { applied: 0, skipped: 0, pending: false }
  for (const s of found.reverse()) {
    if (s.err != null) {
      // failed on-chain: nothing changed there, so nothing changes here; just move past it
      await applyTransaction(db, { sig: s.signature, slot: s.slot, events: [] }, { cursor: true })
      result.skipped++
      continue
    }
    const tx = await rpc
      .getTransaction(s.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment })
      .send()
    if (!tx) {
      // listed but not yet served at this commitment: stop here and pick it up next time, in order
      result.pending = true
      break
    }
    const events = decodeEscrowEvents(tx as unknown as EscrowTransaction, o.program)
    const fresh = await applyTransaction(db, { sig: s.signature, slot: s.slot, events }, { cursor: true })
    if (fresh) result.applied++
    else result.skipped++
    if (events.length)
      o.log?.({ msg: "indexed", sig: s.signature, slot: s.slot.toString(), events: events.map((e) => e.name) })
  }
  return result
}
