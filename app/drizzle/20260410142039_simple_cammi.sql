ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "scope" varchar(30) DEFAULT 'enterprise';--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "scope_detail" varchar(500);