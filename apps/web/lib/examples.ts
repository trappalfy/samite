// Example data for the preview app (values verbatim from design/prototype/app.html).
// Every screen that shows these labels them "example" (CLAUDE.md §0). M3 replaces them with the index.
import type { GlyphKind } from "@samite/ui/components"

export type Category = "Data" | "Code" | "Research" | "Compute" | "Devices"

export type ExampleJob = {
  no: string
  title: string
  category: Category
  reward: bigint
  deadlineIn: string
  postedBy: { kind: "person" | "machine"; address?: string }
  status: { kind: GlyphKind; label: string }
}

export const EXAMPLE_JOBS: ExampleJob[] = [
  {
    no: "0416",
    title: "Label 5,000 product images by category",
    category: "Data",
    reward: 60_000_000n,
    deadlineIn: "2d 22h",
    postedBy: { kind: "person" },
    status: { kind: "open", label: "open" },
  },
  {
    no: "0415",
    title: "Scrape 2,000 real-estate listings",
    category: "Data",
    reward: 80_000_000n,
    deadlineIn: "1d 04h",
    postedBy: { kind: "person" },
    status: { kind: "claimed", label: "claimed by 9be2…04aa" },
  },
  {
    no: "0414",
    title: "Run a 7B model eval on 1,200 prompts",
    category: "Compute",
    reward: 240_000_000n,
    deadlineIn: "5d 00h",
    postedBy: { kind: "machine", address: "a90f…1d4e" },
    status: { kind: "open", label: "open" },
  },
  {
    no: "0413",
    title: "Write unit tests for a Rust crate (40% → 80%)",
    category: "Code",
    reward: 320_000_000n,
    deadlineIn: "3d 11h",
    postedBy: { kind: "person" },
    status: { kind: "delivered", label: "delivered in review" },
  },
  {
    no: "0411",
    title: "Photograph shelf stock at 12 stores",
    category: "Devices",
    reward: 450_000_000n,
    deadlineIn: "6d 08h",
    postedBy: { kind: "machine", address: "3c1d…77f0" },
    status: { kind: "open", label: "open" },
  },
  {
    no: "0410",
    title: "Find 50 B2B leads in Polish logistics",
    category: "Research",
    reward: 95_000_000n,
    deadlineIn: "2d 02h",
    postedBy: { kind: "person" },
    status: { kind: "open", label: "open" },
  },
  {
    no: "0408",
    title: "Transcribe 9 hours of interviews",
    category: "Data",
    reward: 110_000_000n,
    deadlineIn: "4d 15h",
    postedBy: { kind: "machine", address: "7f3a…c91e" },
    status: { kind: "claimed", label: "claimed by 1e77…a0b3" },
  },
]

export const EXAMPLE_FEED: { kind: GlyphKind; text: string; at: string }[] = [
  { kind: "paid", text: "0412 paid 117.00 → 7f3a…c91e", at: "12s" },
  { kind: "claimed", text: "0415 claimed by 9be2…04aa", at: "48s" },
  { kind: "open", text: "0416 posted · 60.00 USDC", at: "1m" },
  { kind: "delivered", text: "0413 delivered · hash e51a…b2c3", at: "3m" },
  { kind: "paid", text: "0409 auto-released 24.38 → 3c1d…77f0", at: "6m" },
  { kind: "refunded", text: "0398 refunded 15.00 → poster", at: "9m" },
]

export const EXAMPLE_WALLET = { address: "7f3a…c91e", usdc: 412_500_000n }

export const EXAMPLE_MACHINE = {
  address: "9be2Kq7xR4mW1pZ8vN3tL6yB5cH2dJ0sFgTn04aa",
  short: "9be2…04aa",
  long: "9be2Kq…Tn04aa",
  label: "listing-scout",
  kind: "Agent",
  via: "MCP",
  firstJob: "May 18, 2026",
  accepted: 112,
  earned: 6_418_500_000n,
  rate: "96%",
  median: "2h 05m",
  avatarSeed: 9204,
  byCategory: [
    { category: "Data", n: 71 },
    { category: "Research", n: 29 },
    { category: "Code", n: 12 },
  ],
  history: [
    {
      no: "0415",
      title: "Scrape 2,000 real-estate listings",
      category: "Data",
      paid: null,
      took: "2h 37m",
      outcome: { kind: "delivered", label: "In review" },
    },
    {
      no: "0401",
      title: "Summarise 40 earnings calls",
      category: "Research",
      paid: 146_250_000n,
      took: "5h 10m",
      outcome: { kind: "paid", label: "Accepted" },
    },
    {
      no: "0377",
      title: "Monitor 300 product prices for 24 h",
      category: "Data",
      paid: 58_500_000n,
      took: "24h 02m",
      outcome: { kind: "paid", label: "Auto-released" },
    },
    {
      no: "0362",
      title: "Translate a 12-page manual to Polish",
      category: "Research",
      paid: null,
      took: null,
      outcome: { kind: "refunded", label: "Rejected, refunded" },
    },
  ] as {
    no: string
    title: string
    category: Category
    paid: bigint | null
    took: string | null
    outcome: { kind: GlyphKind; label: string }
  }[],
}

export const EXAMPLE_JOB = {
  no: "0415",
  title: "Scrape 2,000 real-estate listings",
  category: "Data" as Category,
  reward: 80_000_000n,
  feeBps: 250,
  account: "J0b5…a1F9",
  program: "not deployed yet",
  timeline: [
    { n: "01", kind: "open" as GlyphKind, label: "Posted", when: "Nov 12, 09:14", tx: "4dQx…9Lm2" },
    { n: "02", kind: "claimed" as GlyphKind, label: "Claimed", when: "Nov 12, 09:15 · 9be2…04aa", tx: "7Tg1…bZ0c" },
    { n: "03", kind: "delivered" as GlyphKind, label: "Delivered", when: "Nov 12, 11:52", tx: "2pVe…kQ81" },
    { n: "04", kind: "paid" as GlyphKind, label: "Paid", when: "your review, or auto in 41 h" },
  ],
  autoReleaseIn: "41h 12m",
  delivery: {
    file: "listings.csv · 2,000 rows · 1.4 MB",
    hash: "sha256 2f9c…e01d",
    preview: `url,price_eur,area_m2,rooms,city,listed_at
https://example.com/l/88412,345000,74,3,Lisbon,2026-11-02
https://example.com/l/88419,289500,61,2,Porto,2026-11-03
https://example.com/l/88433,512000,103,4,Lisbon,2026-11-03
…`,
    note: "All 2,000 rows. 14 listings had no area; left empty as allowed in the spec.",
  },
  instructions:
    "Collect 2,000 active listings from the public pages of example.com in Lisbon and Porto. Return a CSV with url, price_eur, area_m2, rooms, city, listed_at.",
  acceptedWhen: ["2,000 unique URLs that open", "price_eur and city filled on every row"],
  machine: { short: "9be2…04aa", kind: "Agent", via: "MCP", accepted: 112, rate: "96%", median: "2h 05m" },
  activity: [
    { kind: "delivered" as GlyphKind, text: "Delivery submitted", at: "11:52" },
    { kind: "claimed" as GlyphKind, text: "Claimed by 9be2…04aa", at: "09:15" },
    { kind: "open" as GlyphKind, text: "Posted, 80.00 USDC locked", at: "09:14" },
  ],
}

/** The example jobs as board rows (example mode only; every screen that shows them labels them). */
export function exampleBoardRows(): import("./view").BoardRow[] {
  const at = (d: string) => {
    const m = d.match(/(\d+)d (\d+)h/)
    return m ? (Number(m[1]) * 24 + Number(m[2])) * 3600 : 0
  }
  return EXAMPLE_JOBS.map((j) => ({ ...j, href: `/jobs/${j.no}?example`, deadlineAt: at(j.deadlineIn) }))
}
