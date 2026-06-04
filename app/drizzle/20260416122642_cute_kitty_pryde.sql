CREATE TABLE IF NOT EXISTS "dim_enterprise_team" (
	"team_id" serial PRIMARY KEY,
	"github_team_id" integer NOT NULL,
	"team_name" varchar(255) NOT NULL,
	"team_slug" varchar(255) NOT NULL,
	"description" text,
	"enterprise_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dim_enterprise_team_member" (
	"id" serial PRIMARY KEY,
	"team_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"user_login" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dim_ent_team_github_id" ON "dim_enterprise_team" ("github_team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dim_ent_team_slug" ON "dim_enterprise_team" ("team_slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dim_ent_team_member_unique" ON "dim_enterprise_team_member" ("team_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dim_ent_team_member_user" ON "dim_enterprise_team_member" ("user_id");--> statement-breakpoint
ALTER TABLE "dim_enterprise_team" ADD CONSTRAINT "dim_enterprise_team_nD3nXMyZEbLd_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "dim_enterprise"("enterprise_id");--> statement-breakpoint
ALTER TABLE "dim_enterprise_team_member" ADD CONSTRAINT "dim_enterprise_team_member_2Yk3g89xjbyc_fkey" FOREIGN KEY ("team_id") REFERENCES "dim_enterprise_team"("team_id");