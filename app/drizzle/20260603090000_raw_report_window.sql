ALTER TABLE "raw_copilot_usage" ADD COLUMN IF NOT EXISTS "report_start_day" date;--> statement-breakpoint
ALTER TABLE "raw_copilot_usage" ADD COLUMN IF NOT EXISTS "report_end_day" date;
