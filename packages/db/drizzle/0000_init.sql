CREATE TABLE "deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_pda" text NOT NULL,
	"job_no" integer NOT NULL,
	"attempt" integer NOT NULL,
	"worker" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"delivery_hash" text NOT NULL,
	"storage_keys" text[] DEFAULT '{}' NOT NULL,
	"submitted_sig" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_pda" text NOT NULL,
	"job_no" integer NOT NULL,
	"kind" text NOT NULL,
	"actor" text NOT NULL,
	"amount" numeric(20, 0),
	"fee" numeric(20, 0),
	"data" jsonb,
	"slot" bigint NOT NULL,
	"sig" text NOT NULL,
	"ix" integer NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_slot" bigint NOT NULL,
	"last_sig" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"display_no" integer PRIMARY KEY NOT NULL,
	"pda" text NOT NULL,
	"poster" text NOT NULL,
	"posted_from" text NOT NULL,
	"job_id" numeric(20, 0) NOT NULL,
	"spec_hash" text NOT NULL,
	"reward" numeric(20, 0) NOT NULL,
	"fee_bps" integer NOT NULL,
	"status" text NOT NULL,
	"worker" text,
	"policy" jsonb NOT NULL,
	"allowlist" text[] DEFAULT '{}' NOT NULL,
	"deadline" bigint NOT NULL,
	"review_window" integer NOT NULL,
	"claim_window" integer NOT NULL,
	"deliveries" integer DEFAULT 0 NOT NULL,
	"delivery_hash" text,
	"created_at" bigint NOT NULL,
	"claimed_at" bigint,
	"delivered_at" bigint,
	"closed_at" bigint,
	"posted_slot" bigint NOT NULL,
	"updated_slot" bigint NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"address" text PRIMARY KEY NOT NULL,
	"accepted" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"earned" numeric(20, 0) DEFAULT 0 NOT NULL,
	"first_seen" bigint NOT NULL,
	"last_paid_at" bigint,
	"label" text,
	"updated_slot" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posters" (
	"address" text PRIMARY KEY NOT NULL,
	"posted" integer DEFAULT 0 NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"refunded_after_delivery" integer DEFAULT 0 NOT NULL,
	"rejections" integer DEFAULT 0 NOT NULL,
	"cancelled" integer DEFAULT 0 NOT NULL,
	"updated_slot" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejections" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_pda" text NOT NULL,
	"job_no" integer NOT NULL,
	"attempt" integer NOT NULL,
	"reason" text NOT NULL,
	"reason_hash" text NOT NULL,
	"sig" text,
	"at" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specs" (
	"spec_hash" text PRIMARY KEY NOT NULL,
	"canonical" "bytea" NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"json" jsonb NOT NULL,
	"verdict" text DEFAULT 'pending' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"posted_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deliveries_job_idx" ON "deliveries" USING btree ("job_no");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_job_hash_idx" ON "deliveries" USING btree ("job_no","delivery_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "events_sig_ix_idx" ON "events" USING btree ("sig","ix");--> statement-breakpoint
CREATE INDEX "events_job_idx" ON "events" USING btree ("job_no");--> statement-breakpoint
CREATE INDEX "events_slot_idx" ON "events" USING btree ("slot");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_live_pda_idx" ON "jobs" USING btree ("pda") WHERE "jobs"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "jobs_pda_idx" ON "jobs" USING btree ("pda");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_poster_idx" ON "jobs" USING btree ("poster");--> statement-breakpoint
CREATE INDEX "jobs_worker_idx" ON "jobs" USING btree ("worker");--> statement-breakpoint
CREATE INDEX "jobs_spec_hash_idx" ON "jobs" USING btree ("spec_hash");--> statement-breakpoint
CREATE INDEX "rejections_job_idx" ON "rejections" USING btree ("job_no");