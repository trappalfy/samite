// How Samite measures text limits (CLAUDE.md §5). Use these in UI counters so they agree with the API.

/** "Characters" in every limit: Unicode code points after NFC (an emoji is 1, e + U+0301 is 1). */
export function charCount(text: string): number {
  let n = 0
  for (const _ of text.normalize("NFC")) n++
  return n
}

/** "KB" limits: UTF-8 bytes after NFC. */
export function byteCount(text: string): number {
  return new TextEncoder().encode(text.normalize("NFC")).length
}
