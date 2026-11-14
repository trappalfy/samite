// CLAUDE.md §8. The chain is the source of truth for money and status; these tables are an index, the spec and
// delivery store, and the moderation record. Deviations from §8 are logged in docs/DECISIONS.md ("M3 — db").
import { sql } from "drizzle-orm"
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  bigint,
} from "drizzle-orm/pg-core"

/** u64 amounts (base units) don't fit Postgres bigint (signed 64-bit), so they are numeric(20,0) read as JS bigint. */
const u64 = (name: string) => numeric(name, { precision: 20, scale: 0, mode: "bigint" })
/** i64 chain values: unix seconds and slots. */
const i64 = (name: string) => bigint(name, { mode: "bigint" })
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => new Uint8Array(v),
})
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

export type Verdict = "pass" | "refuse" | "pending"
export type PostedFrom = "app" | "api"
export type JobStatus = "open" | "claimed" | "delivered" | "paid" | "refunded" | "cancelled"
export type EventKind =
  | "posted"
  | "claimed"
  | "unclaimed"
  | "claim_expired"
  | "delivered"
  | "rejected"
  | "paid"
  | "auto_released"
  | "refunded"
  | "cancelled"
export type Policy = { kind: "any" } | { kind: "proven"; minAccepted: number } | { kind: "allowlist" }

export const specs = pgTable("specs", {
  specHash: text("spec_hash").primaryKey(), // hex sha256 of the canonical bytes
  canonical: bytea("canonical").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  json: jsonb("json").notNull(),
  verdict: text("verdict").$type<Verdict>().notNull().default("pending"),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  postedFrom: text("posted_from").$type<PostedFrom>(), // set when the spec came in through the app's session
  createdAt: createdAt(),
})

export const jobs = pgTable(
  "jobs",
  {
    // the display number (0415) is the key: a poster may re-use a job id once the job has closed, which gives the
    // same PDA again, so a PDA names at most one live job and any number of closed ones
    displayNo: integer("display_no").primaryKey(), // in JobPosted slot order
    pda: text("pda").notNull(),
    poster: text("poster").notNull(),
    postedFrom: text("posted_from").$type<PostedFrom>().notNull(),
    jobId: numeric("job_id", { precision: 20, scale: 0 }).notNull(), // u64 as a decimal string
    // not a foreign key: a job posted on-chain without going through POST /specs is still indexed, and stays hidden
    specHash: text("spec_hash").notNull(),
    reward: u64("reward").notNull(),
    feeBps: integer("fee_bps").notNull(),
    status: text("status").$type<JobStatus>().notNull(),
    worker: text("worker"),
    policy: jsonb("policy").$type<Policy>().notNull(),
    allowlist: text("allowlist").array().notNull().default([]),
    deadline: i64("deadline").notNull(),
    reviewWindow: integer("review_window").notNull(),
    claimWindow: integer("claim_window").notNull(),
    deliveries: integer("deliveries").notNull().default(0),
    deliveryHash: text("delivery_hash"),
    createdAt: i64("created_at").notNull(),
    claimedAt: i64("claimed_at"),
    deliveredAt: i64("delivered_at"),
    closedAt: i64("closed_at"),
    postedSlot: i64("posted_slot").notNull(),
    updatedSlot: i64("updated_slot").notNull(),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [
    uniqueIndex("jobs_live_pda_idx")
      .on(t.pda)
      .where(sql`${t.closedAt} is null`),
    index("jobs_pda_idx").on(t.pda),
    index("jobs_status_idx").on(t.status),
    index("jobs_poster_idx").on(t.poster),
    index("jobs_worker_idx").on(t.worker),
    index("jobs_spec_hash_idx").on(t.specHash),
  ],
)

export const deliveries = pgTable(
  "deliveries",
  {
    id: serial("id").primaryKey(),
    jobPda: text("job_pda").notNull(),
    jobNo: integer("job_no").notNull(),
    attempt: integer("attempt").notNull(),
    worker: text("worker").notNull(),
    manifest: jsonb("manifest").notNull(),
    deliveryHash: text("delivery_hash").notNull(),
    storageKeys: text("storage_keys").array().notNull().default([]),
    submittedSig: text("submitted_sig"),
    createdAt: createdAt(),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    /** When the content (files, text, link, note) was deleted; the hash stays (apps/worker/src/purge.ts). */
    prunedAt: timestamp("pruned_at", { withTimezone: true }),
  },
  (t) => [index("deliveries_job_idx").on(t.jobNo), uniqueIndex("deliveries_job_hash_idx").on(t.jobNo, t.deliveryHash)],
)

export const rejections = pgTable(
  "rejections",
  {
    id: serial("id").primaryKey(),
    jobPda: text("job_pda").notNull(),
    jobNo: integer("job_no").notNull(),
    attempt: integer("attempt").notNull(),
    reason: text("reason").notNull(),
    reasonHash: text("reason_hash").notNull(),
    sig: text("sig"), // null until the indexer sees DeliveryRejected with this hash
    at: i64("at"),
    createdAt: createdAt(),
  },
  (t) => [index("rejections_job_idx").on(t.jobNo)],
)

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    jobPda: text("job_pda").notNull(),
    jobNo: integer("job_no").notNull(),
    kind: text("kind").$type<EventKind>().notNull(),
    actor: text("actor").notNull(),
    amount: u64("amount"),
    fee: u64("fee"),
    data: jsonb("data"), // the rest of the event (hashes, deadlines), as decoded
    slot: i64("slot").notNull(),
    // one transaction can emit several events (DeliveryRejected + JobRefunded), so a row is (signature, index)
    sig: text("sig").notNull(),
    ix: integer("ix").notNull(),
    at: i64("at").notNull(),
  },
  (t) => [
    uniqueIndex("events_sig_ix_idx").on(t.sig, t.ix),
    index("events_job_idx").on(t.jobNo),
    index("events_slot_idx").on(t.slot),
  ],
)

export const machines = pgTable("machines", {
  address: text("address").primaryKey(),
  accepted: integer("accepted").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  earned: u64("earned")
    .notNull()
    .default(sql`0`),
  firstSeen: i64("first_seen").notNull(),
  lastPaidAt: i64("last_paid_at"),
  label: text("label"),
  updatedSlot: i64("updated_slot")
    .notNull()
    .default(sql`0`),
})

export const posters = pgTable("posters", {
  address: text("address").primaryKey(),
  posted: integer("posted").notNull().default(0),
  paid: integer("paid").notNull().default(0),
  refundedAfterDelivery: integer("refunded_after_delivery").notNull().default(0),
  rejections: integer("rejections").notNull().default(0),
  cancelled: integer("cancelled").notNull().default(0),
  updatedSlot: i64("updated_slot")
    .notNull()
    .default(sql`0`),
})

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  address: text("address").notNull(),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
})

/** Where the indexer stopped: the newest signature it applied, for the backfill on start. */
export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  lastSlot: i64("last_slot").notNull(),
  lastSig: text("last_sig"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Short-lived shared state for the web app: replay protection of signed requests, sign-in nonces and rate-limit
 * counters (apps/web/lib/server/kv.ts). Instead of Redis (the owner's choice, Nov 14): one service fewer. Rows past
 * `expires_at` count as absent; the worker deletes them.
 */
export const kv = pgTable(
  "kv",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("kv_expires_at_idx").on(t.expiresAt)],
)
