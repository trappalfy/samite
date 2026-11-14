// Deletes a delivery's content once its job has been closed for the retention period (§5.2; the privacy page says 90
// days). The indexer sets `deliveries.purge_after` when a job closes. Everything the machine handed over goes: the
// files from storage, and the text, link, note and file names from the stored manifest (the owner's call, Nov 13: not
// only the files). What stays is the record that a delivery happened: the job, the attempt, the kind, and the hash,
// which is on-chain anyway. Deleting a missing object is not an error, so a run cut short is simply repeated.
import { and, eq, isNull, lte } from "drizzle-orm"
import { schema, type Db } from "@samite/db"
import type { BlobStore } from "@samite/storage"

const { deliveries } = schema

/** What is kept of a manifest after its retention period: no content, no names. */
export function prunedManifest(m: unknown): Record<string, unknown> {
  const o = (m ?? {}) as Record<string, unknown>
  return { v: o.v, job: o.job, attempt: o.attempt, kind: o.kind, deleted: true }
}

export async function purgeDeliveries(
  db: Db,
  store: BlobStore,
  o: { now?: Date; batch?: number; log?: (l: Record<string, unknown>) => void } = {},
): Promise<number> {
  const now = o.now ?? new Date()
  const due = await db
    .select({ id: deliveries.id, jobNo: deliveries.jobNo, keys: deliveries.storageKeys, manifest: deliveries.manifest })
    .from(deliveries)
    .where(and(lte(deliveries.purgeAfter, now), isNull(deliveries.prunedAt)))
    .limit(o.batch ?? 100)
  for (const d of due) {
    for (const key of d.keys) await store.delete(key)
    await db
      .update(deliveries)
      .set({ storageKeys: [], manifest: prunedManifest(d.manifest), prunedAt: now })
      .where(eq(deliveries.id, d.id))
    // counts only: never file names or contents
    o.log?.({ msg: "delivery deleted", job: d.jobNo, files: d.keys.length })
  }
  return due.length
}
