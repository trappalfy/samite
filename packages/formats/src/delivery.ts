// samite/delivery@1 (CLAUDE.md §5.2): the manifest a machine submits. Private; its hash goes on-chain.

import { z } from "zod"
import type { Issue, PathSegment } from "./errors"
import { charsAtMost, fileName, httpsUrl, integer, list, sha256Hex, solanaAddress, utf8Bytes } from "./fields"
import { parseWith } from "./issues"
import { FORMAT_LIMITS } from "./limits"

const L = FORMAT_LIMITS.delivery

export const DELIVERY_VERSION = "samite/delivery@1"

const deliveredFile = z.strictObject({
  name: fileName,
  bytes: integer({ min: 0, max: L.fileMaxBytes }),
  sha256: sha256Hex,
})

const files = list(deliveredFile, { min: 1, max: L.filesMax }).check((ctx) => {
  const first = new Map<string, number>()
  ctx.value.forEach((file, i) => {
    const earlier = first.get(file.name)
    if (earlier === undefined) {
      first.set(file.name, i)
      return
    }
    const message = `is already used by file ${earlier + 1}.`
    ctx.issues.push({ code: "custom", message, input: file.name, path: [i, "name"] })
  })
})

const envelope = {
  v: z.literal(DELIVERY_VERSION),
  job: solanaAddress,
  attempt: integer({ min: L.minAttempt, max: L.maxAttempt }),
  note: charsAtMost(L.noteMaxChars).optional(),
}

/**
 * The samite/delivery@1 schema: `kind` decides which payload field is present. It does not
 * normalise: use `parseDelivery`, which applies NFC first.
 */
export const deliverySchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...envelope, kind: z.literal("file"), files }),
  z.strictObject({
    ...envelope,
    kind: z.literal("text"),
    text: utf8Bytes({ maxBytes: L.textMaxBytes, pronoun: "it is" }),
  }),
  z.strictObject({ ...envelope, kind: z.literal("url"), url: httpsUrl }),
])

export type Delivery = z.infer<typeof deliverySchema>
export type DeliveredFile = z.infer<typeof deliveredFile>

export type DeliveryResult = { ok: true; delivery: Delivery } | { ok: false; errors: Issue[] }

/** Check a delivery manifest (a parsed JSON value). On success `delivery` is the NFC form, ready for `deliveryHash`. */
export function parseDelivery(input: unknown): DeliveryResult {
  const r = parseWith(deliverySchema, input, deliveryLabel)
  return r.ok ? { ok: true, delivery: r.value } : r
}

const TOP: Record<string, string> = {
  v: "Version (v)",
  job: "Job",
  attempt: "Attempt",
  kind: "Kind",
  text: "Text",
  url: "URL",
  note: "Note",
}

function deliveryLabel(path: readonly PathSegment[]): string {
  const [head, index, field] = path
  if (head === undefined) return "The delivery"
  if (head === "files") {
    if (typeof index !== "number") return "Files"
    return field === undefined ? `File ${index + 1}` : `File ${index + 1} ${String(field)}`
  }
  return TOP[String(head)] ?? `The delivery field ${String(head)}`
}
