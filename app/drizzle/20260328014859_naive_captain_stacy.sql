ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "records_skipped" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "raw_copilot_usage" ADD COLUMN IF NOT EXISTS "content_hash" varchar(64);