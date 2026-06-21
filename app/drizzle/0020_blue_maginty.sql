CREATE TABLE IF NOT EXISTS "ai_insights" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" varchar(50) NOT NULL,
	"scope_key" varchar(255) NOT NULL,
	"window_start" date,
	"window_end" date,
	"content_hash" varchar(64) NOT NULL,
	"model" varchar(255),
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_insights_unique" ON "ai_insights" USING btree ("kind","scope_key","content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_insights_kind" ON "ai_insights" USING btree ("kind");