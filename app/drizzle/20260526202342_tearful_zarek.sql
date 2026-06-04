ALTER TABLE "fact_cli_daily" ADD COLUMN IF NOT EXISTS "source_team_github_id" integer;--> statement-breakpoint
ALTER TABLE "fact_copilot_usage_daily" ADD COLUMN IF NOT EXISTS "source_team_github_id" integer;--> statement-breakpoint
ALTER TABLE "fact_user_feature_daily" ADD COLUMN IF NOT EXISTS "source_team_github_id" integer;--> statement-breakpoint
ALTER TABLE "fact_user_ide_daily" ADD COLUMN IF NOT EXISTS "source_team_github_id" integer;--> statement-breakpoint
ALTER TABLE "fact_user_language_daily" ADD COLUMN IF NOT EXISTS "source_team_github_id" integer;--> statement-breakpoint
ALTER TABLE "fact_user_language_model_daily" ADD COLUMN IF NOT EXISTS "source_team_github_id" integer;--> statement-breakpoint
ALTER TABLE "fact_user_model_daily" ADD COLUMN IF NOT EXISTS "source_team_github_id" integer;--> statement-breakpoint
ALTER TABLE "raw_copilot_usage" ADD COLUMN IF NOT EXISTS "source_team_github_id" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fact_usage_source_team_github_id" ON "fact_copilot_usage_daily" ("source_team_github_id");
--> statement-breakpoint
UPDATE "raw_copilot_usage"
SET "source_team_github_id" = NULLIF(raw_json->>'team_id', '')::integer
WHERE raw_json ? 'team_id'
  AND COALESCE(raw_json->>'team_id', '') ~ '^[0-9]+$';
--> statement-breakpoint
UPDATE "fact_copilot_usage_daily" f
SET "source_team_github_id" = r."source_team_github_id"
FROM "raw_copilot_usage" r
WHERE f."day" = r."report_date"
  AND f."enterprise_id" = r."enterprise_id"
  AND f."user_id" = r."user_id"
  AND f."source_team_github_id" IS NULL
  AND r."source_team_github_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "fact_user_feature_daily" f
SET "source_team_github_id" = (
  SELECT max(r."source_team_github_id")
  FROM "raw_copilot_usage" r
  WHERE r."report_date" = f."day"
    AND r."user_id" = f."user_id"
)
WHERE f."source_team_github_id" IS NULL;
--> statement-breakpoint
UPDATE "fact_user_ide_daily" f
SET "source_team_github_id" = (
  SELECT max(r."source_team_github_id")
  FROM "raw_copilot_usage" r
  WHERE r."report_date" = f."day"
    AND r."user_id" = f."user_id"
)
WHERE f."source_team_github_id" IS NULL;
--> statement-breakpoint
UPDATE "fact_user_language_daily" f
SET "source_team_github_id" = (
  SELECT max(r."source_team_github_id")
  FROM "raw_copilot_usage" r
  WHERE r."report_date" = f."day"
    AND r."user_id" = f."user_id"
)
WHERE f."source_team_github_id" IS NULL;
--> statement-breakpoint
UPDATE "fact_user_model_daily" f
SET "source_team_github_id" = (
  SELECT max(r."source_team_github_id")
  FROM "raw_copilot_usage" r
  WHERE r."report_date" = f."day"
    AND r."user_id" = f."user_id"
)
WHERE f."source_team_github_id" IS NULL;
--> statement-breakpoint
UPDATE "fact_user_language_model_daily" f
SET "source_team_github_id" = (
  SELECT max(r."source_team_github_id")
  FROM "raw_copilot_usage" r
  WHERE r."report_date" = f."day"
    AND r."user_id" = f."user_id"
)
WHERE f."source_team_github_id" IS NULL;
--> statement-breakpoint
UPDATE "fact_cli_daily" f
SET "source_team_github_id" = (
  SELECT max(r."source_team_github_id")
  FROM "raw_copilot_usage" r
  WHERE r."report_date" = f."day"
    AND r."user_id" = f."user_id"
)
WHERE f."source_team_github_id" IS NULL;