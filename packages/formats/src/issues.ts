// Turns zod issues into one sentence per field, suitable for showing to a person:
// "<Label> <predicate>", e.g. "Title must be 8–120 characters (it has 5)."

import type { z } from "zod"
import { FormatError, formatPath, type Issue, type PathSegment } from "./errors"
import { normalizeNfc } from "./canonical"

export type Labeller = (path: readonly PathSegment[]) => string

type ZodIssue = z.core.$ZodIssue

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Issue[] }

/** NFC-normalise `input`, then check it against `schema`, reporting at most one error per field. */
export function parseWith<T>(schema: z.ZodType<T>, input: unknown, label: Labeller): Parsed<T> {
  let normalised: unknown
  try {
    normalised = normalizeNfc(input)
  } catch (e) {
    if (!(e instanceof FormatError)) throw e
    return { ok: false, errors: [{ path: e.path, message: sentence(label(e.segments), `${e.reason}.`) }] }
  }
  const result = schema.safeParse(normalised)
  if (result.success) return { ok: true, value: result.data }
  return { ok: false, errors: toIssues(result.error.issues, normalised, label) }
}

function toIssues(issues: readonly ZodIssue[], input: unknown, label: Labeller): Issue[] {
  const out: Issue[] = []
  const seen = new Set<string>()
  for (const issue of issues) {
    for (const { path, message } of explain(issue, input, label)) {
      const key = formatPath(path)
      if (seen.has(key)) continue // one message per field is enough
      seen.add(key)
      out.push({ path: key, message })
    }
  }
  return out
}

function explain(issue: ZodIssue, input: unknown, label: Labeller): { path: PathSegment[]; message: string }[] {
  const path = issue.path.filter((p): p is PathSegment => typeof p !== "symbol")
  const at = (predicate: string) => [{ path, message: sentence(label(path), predicate) }]
  // A field that isn't there at all is "required", whatever it was meant to be.
  const missing = path.length > 0 && valueAt(input, path) === undefined
  switch (issue.code) {
    case "custom":
      return at(issue.message)
    case "invalid_type":
      return at(missing ? "is required." : `must be ${noun(issue.expected)}.`)
    case "invalid_value":
      if (missing) return at("is required.")
      return at(
        issue.values.length === 1
          ? `must be ${JSON.stringify(issue.values[0])}.`
          : `must be one of: ${issue.values.join(", ")}.`,
      )
    case "invalid_union":
      if (issue.discriminator !== undefined) {
        const tagPath = path.at(-1) === issue.discriminator ? path : [...path, issue.discriminator]
        const tag = valueAt(input, tagPath)
        const options = "options" in issue ? (issue.options ?? []) : []
        const predicate = tag === undefined ? "is required." : `must be one of: ${options.join(", ")}.`
        return [{ path: tagPath, message: sentence(label(tagPath), predicate) }]
      }
      return at("is not valid.")
    case "unrecognized_keys":
      return issue.keys.map((key) => ({
        path: [...path, key],
        message: sentence(label(path), `has an unknown field ${JSON.stringify(key)}.`),
      }))
    default:
      return at(`is not valid (${issue.message}).`)
  }
}

function noun(expected: string): string {
  switch (expected) {
    case "string":
      return "text"
    case "number":
    case "int":
      return "a whole number"
    case "array":
      return "a list"
    case "object":
      return "a JSON object"
    case "boolean":
      return "true or false"
    default:
      return expected
  }
}

function valueAt(input: unknown, path: readonly PathSegment[]): unknown {
  let v = input
  for (const p of path) {
    if (typeof v !== "object" || v === null) return undefined
    v = (v as Record<PathSegment, unknown>)[p]
  }
  return v
}

function sentence(label: string, predicate: string): string {
  return `${label} ${predicate}`
}
