-- Reconciliation migration: capture schema drift that was previously applied to
-- some databases only via `drizzle-kit push` (schema.ts) and never recorded in a
-- migration. Migrations-only databases (e.g. production) were missing these
-- columns/tables. All statements are idempotent so this is safe to apply to any
-- database regardless of its current state.

-- fact_copilot_usage_daily: agent / code-review usage flags
ALTER TABLE "fact_copilot_usage_daily" ADD COLUMN IF NOT EXISTS "used_copilot_cloud_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_copilot_usage_daily" ADD COLUMN IF NOT EXISTS "used_code_review_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_copilot_usage_daily" ADD COLUMN IF NOT EXISTS "used_code_review_passive" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- fact_user_feature_daily: LOC breakdown columns
ALTER TABLE "fact_user_feature_daily" ADD COLUMN IF NOT EXISTS "loc_suggested_to_add_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_user_feature_daily" ADD COLUMN IF NOT EXISTS "loc_suggested_to_delete_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_user_feature_daily" ADD COLUMN IF NOT EXISTS "loc_added_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_user_feature_daily" ADD COLUMN IF NOT EXISTS "loc_deleted_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- fact_user_ide_daily: LOC breakdown columns
ALTER TABLE "fact_user_ide_daily" ADD COLUMN IF NOT EXISTS "loc_suggested_to_add_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_user_ide_daily" ADD COLUMN IF NOT EXISTS "loc_suggested_to_delete_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_user_ide_daily" ADD COLUMN IF NOT EXISTS "loc_added_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_user_ide_daily" ADD COLUMN IF NOT EXISTS "loc_deleted_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- fact_cli_daily: average tokens per request
ALTER TABLE "fact_cli_daily" ADD COLUMN IF NOT EXISTS "avg_tokens_per_request" numeric;--> statement-breakpoint

-- fact_user_ide_version_daily: entire table was never captured in a migration
CREATE TABLE IF NOT EXISTS "fact_user_ide_version_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"user_id" integer NOT NULL,
	"ide_id" integer NOT NULL,
	"ide_version" varchar(100),
	"plugin_name" varchar(100),
	"plugin_version" varchar(100),
	"sampled_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "fact_user_ide_version_daily" ADD CONSTRAINT "fact_user_ide_version_daily_ide_id_dim_ide_ide_id_fk" FOREIGN KEY ("ide_id") REFERENCES "public"."dim_ide"("ide_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fact_ide_version_unique" ON "fact_user_ide_version_daily" USING btree ("day","user_id","ide_id");
