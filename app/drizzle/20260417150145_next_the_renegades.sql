CREATE INDEX IF NOT EXISTS "idx_dim_user_is_current" ON "dim_user" ("is_current");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dim_user_org_id" ON "dim_user" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fact_usage_user_id" ON "fact_copilot_usage_daily" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fact_usage_enterprise_id" ON "fact_copilot_usage_daily" ("enterprise_id");