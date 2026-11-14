import { FORMAT_LIMITS } from "./limits"

export type PathSegment = string | number

/** A problem with one field, worded for a person. `path` is like `attachments[0].sha256`; "" is the whole value. */
export type Issue = { path: string; message: string }

/**
 * Thrown when a value cannot be canonicalised or hashed. `reason` is a predicate ("contains a lone
 * surrogate (invalid Unicode)") and `segments` locate the bad value.
 */
export class FormatError extends Error {
  override readonly name = "FormatError"
  readonly segments: readonly PathSegment[]
  readonly reason: string

  constructor(segments: readonly PathSegment[], reason: string) {
    const path = formatPath(segments)
    super(path ? `${path}: ${reason}` : reason)
    this.segments = [...segments]
    this.reason = reason
  }

  get path(): string {
    return formatPath(this.segments)
  }
}

export const TOO_DEEP = `is nested more than ${FORMAT_LIMITS.maxDepth} levels deep`

/** `["a", 1, "b"]` → `a[1].b`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = ""
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`
    else if (typeof segment === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))
      out += out ? `.${segment}` : segment
    else out += `[${JSON.stringify(String(segment))}]`
  }
  return out
}
