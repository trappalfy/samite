// Every limit in CLAUDE.md §5. "Characters" are Unicode code points after NFC; "KB" and "MB" are
// binary (the §5.1 example's max_bytes, 209715200, is 200 × 1024 × 1024).

const KB = 1024
const MB = 1024 * KB

export const FORMAT_LIMITS = {
  job: {
    titleMinChars: 8,
    titleMaxChars: 120,
    instructionsMaxBytes: 16 * KB,
    acceptedWhenMinItems: 1,
    acceptedWhenMaxItems: 10,
    acceptedWhenMaxChars: 280,
    fileMaxBytes: 200 * MB,
    attachmentsMax: 10,
  },
  delivery: {
    minAttempt: 1,
    maxAttempt: 3, // = LIMITS.maxDeliveries in @samite/config (§4.4)
    textMaxBytes: 64 * KB,
    fileMaxBytes: 200 * MB,
    filesMax: 100,
    noteMaxChars: 1000,
  },
  reason: {
    minChars: 10,
    maxChars: 1000,
  },
  fileNameMaxChars: 255,
  urlMaxChars: 2048,
  /** Objects and arrays nested deeper are refused (the formats need 3), instead of overflowing the stack. */
  maxDepth: 100,
} as const

/** Below these the spec is accepted with a warning. */
export const WARN_BELOW = {
  instructionsChars: 40,
  criterionChars: 12,
} as const
