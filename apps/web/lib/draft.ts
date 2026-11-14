// The job someone is writing in "Post a job", kept in this browser only (localStorage), so a reload or a closed tab
// loses nothing. Cleared when the job is posted or with "Clear the form". Never sent anywhere (privacy page: "In your
// browser"). Storage can be missing or throw (private windows, blocked site data): then the form simply isn't kept.
const KEY = "samite:post-draft:v1"

export type Draft = {
  title: string
  instructions: string
  accepted: string
  kind: string
  category: string
  reward: string
  deadline: string
  review: string
  policy: string
  allow: string
}

/** The saved draft's string fields; anything else in storage is ignored. The form checks each choice it restores. */
export function loadDraft(): Partial<Draft> | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null")
    if (!v || typeof v !== "object" || Array.isArray(v)) return null
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Partial<Draft>
  } catch {
    return null
  }
}

export function saveDraft(d: Draft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* not kept: storage is full or blocked */
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing was kept */
  }
}
