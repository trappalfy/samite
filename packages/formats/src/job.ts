// samite/job@1 (CLAUDE.md §5.1): what machines read. Public; its hash is Job.spec_hash on-chain.

import { z } from "zod"
import type { Issue, PathSegment } from "./errors"
import { chars, fileName, httpsUrl, integer, list, sha256Hex, utf8Bytes } from "./fields"
import { parseWith } from "./issues"
import { FORMAT_LIMITS, WARN_BELOW } from "./limits"
import { charCount } from "./text"

const L = FORMAT_LIMITS.job

export const JOB_VERSION = "samite/job@1"
export const CATEGORIES = ["data", "code", "research", "compute", "devices", "other"] as const
export const DELIVERABLE_KINDS = ["text", "file", "url"] as const

const attachmentSchema = z.strictObject({ name: fileName, url: httpsUrl, sha256: sha256Hex })

const deliverableSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text") }),
  z.strictObject({
    kind: z.literal("file"),
    max_bytes: integer({ min: 1, max: L.fileMaxBytes, unit: " bytes (200 MB)" }),
  }),
  z.strictObject({ kind: z.literal("url") }),
])

/**
 * The samite/job@1 schema. It does not normalise: use `parseJobSpec`, which applies NFC first so
 * that what is checked is what gets hashed.
 */
export const jobSpecSchema = z.strictObject({
  v: z.literal(JOB_VERSION),
  title: chars({ min: L.titleMinChars, max: L.titleMaxChars, singleLine: true }),
  instructions: utf8Bytes({ maxBytes: L.instructionsMaxBytes, pronoun: "they are" }),
  accepted_when: list(chars({ min: 1, max: L.acceptedWhenMaxChars }), {
    min: L.acceptedWhenMinItems,
    max: L.acceptedWhenMaxItems,
  }),
  deliverable: deliverableSchema,
  category: z.enum(CATEGORIES),
  attachments: list(attachmentSchema, { min: 0, max: L.attachmentsMax }).optional(),
})

export type JobSpec = z.infer<typeof jobSpecSchema>
export type Category = JobSpec["category"]
export type Deliverable = JobSpec["deliverable"]
export type Attachment = NonNullable<JobSpec["attachments"]>[number]

export type JobSpecResult = { ok: true; spec: JobSpec; warnings: Issue[] } | { ok: false; errors: Issue[] }

/**
 * Check a job spec (a parsed JSON value). On success `spec` is the NFC form, ready for `specHash`,
 * and `warnings` lists things worth fixing that don't block posting.
 */
export function parseJobSpec(input: unknown): JobSpecResult {
  const r = parseWith(jobSpecSchema, input, jobLabel)
  return r.ok ? { ok: true, spec: r.value, warnings: jobWarnings(r.value) } : r
}

function jobWarnings(spec: JobSpec): Issue[] {
  const warnings: Issue[] = []
  const n = charCount(spec.instructions)
  if (n < WARN_BELOW.instructionsChars) {
    warnings.push({
      path: "instructions",
      message: `Instructions are short (${n} characters). Machines do better with details.`,
    })
  }
  const firstSeen = new Map<string, number>()
  spec.accepted_when.forEach((item, i) => {
    const path = `accepted_when[${i}]`
    const earlier = firstSeen.get(item.trim())
    if (earlier !== undefined) {
      warnings.push({ path, message: `Acceptance criterion ${i + 1} repeats criterion ${earlier + 1}.` })
      return
    }
    firstSeen.set(item.trim(), i)
    const len = charCount(item)
    if (len < WARN_BELOW.criterionChars) {
      warnings.push({
        path,
        message: `Acceptance criterion ${i + 1} is short (${len} characters). Say what a reviewer can check.`,
      })
    }
  })
  return warnings
}

const ATTACHMENT_FIELDS: Record<string, string> = { name: "name", url: "URL", sha256: "sha256" }

function jobLabel(path: readonly PathSegment[]): string {
  const [head, index, field] = path
  switch (head) {
    case undefined:
      return "The job spec"
    case "v":
      return "Version (v)"
    case "title":
      return "Title"
    case "instructions":
      return "Instructions"
    case "category":
      return "Category"
    case "accepted_when":
      return typeof index === "number" ? `Acceptance criterion ${index + 1}` : "Acceptance criteria"
    case "deliverable":
      return index === undefined ? "Deliverable" : `Deliverable ${String(index)}`
    case "attachments":
      if (typeof index !== "number") return "Attachments"
      return field === undefined
        ? `Attachment ${index + 1}`
        : `Attachment ${index + 1} ${ATTACHMENT_FIELDS[field] ?? field}`
    default:
      return `The job spec field ${String(head)}`
  }
}
