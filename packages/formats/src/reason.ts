// Rejection reason (CLAUDE.md §5.3): plain text, 10–1,000 characters, public.
// reason_hash = sha256(NFC(text)); see reasonHash.

import type { Issue } from "./errors"
import { chars } from "./fields"
import { parseWith } from "./issues"
import { FORMAT_LIMITS } from "./limits"

export const rejectionReasonSchema = chars({ min: FORMAT_LIMITS.reason.minChars, max: FORMAT_LIMITS.reason.maxChars })

export type RejectionReasonResult = { ok: true; reason: string } | { ok: false; errors: Issue[] }

/** Check a rejection reason. On success `reason` is the NFC text, the exact text `reasonHash` hashes. */
export function parseRejectionReason(input: unknown): RejectionReasonResult {
  const r = parseWith(rejectionReasonSchema, input, () => "Reason")
  return r.ok ? { ok: true, reason: r.value } : r
}
