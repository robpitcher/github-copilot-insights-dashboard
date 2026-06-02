ALTER TABLE "fact_copilot_usage_daily" ADD COLUMN "ai_adoption_phase" smallint;--> statement-breakpoint
ALTER TABLE "fact_copilot_usage_daily" ADD COLUMN "ai_adoption_phase_version" varchar(10);--> statement-breakpoint
CREATE INDEX "idx_fact_usage_ai_phase" ON "fact_copilot_usage_daily" ("day","ai_adoption_phase");
--> statement-breakpoint
UPDATE "fact_copilot_usage_daily" f
SET
  "ai_adoption_phase" = CASE
    WHEN jsonb_typeof(r.raw_json->'ai_adoption_phase') = 'object'
      AND COALESCE(r.raw_json->'ai_adoption_phase'->>'phase', '') ~ '^[0-3]$'
      THEN (r.raw_json->'ai_adoption_phase'->>'phase')::smallint
    WHEN jsonb_typeof(r.raw_json->'ai_adoption_phase') = 'number'
      AND COALESCE(r.raw_json->>'ai_adoption_phase', '') ~ '^[0-3]$'
      THEN (r.raw_json->>'ai_adoption_phase')::smallint
    ELSE f."ai_adoption_phase"
  END,
  "ai_adoption_phase_version" = CASE
    WHEN jsonb_typeof(r.raw_json->'ai_adoption_phase') = 'object'
      THEN NULLIF(r.raw_json->'ai_adoption_phase'->>'version', '')
    ELSE f."ai_adoption_phase_version"
  END
FROM "raw_copilot_usage" r
WHERE f."day" = r."report_date"
  AND f."enterprise_id" = r."enterprise_id"
  AND f."user_id" = r."user_id"
  AND r.raw_json ? 'ai_adoption_phase'
  AND f."ai_adoption_phase" IS NULL;
