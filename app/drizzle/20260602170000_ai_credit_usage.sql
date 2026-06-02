CREATE TABLE "fact_ai_credit_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"enterprise_slug" varchar(255) NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"usage_date" date,
	"product" varchar(255) DEFAULT 'Copilot' NOT NULL,
	"sku" varchar(255) DEFAULT '' NOT NULL,
	"model" varchar(255) DEFAULT '' NOT NULL,
	"cost_center" varchar(255),
	"org_name" varchar(255),
	"user_login" varchar(255),
	"team_name" varchar(255),
	"unit_type" varchar(64) DEFAULT 'ai-credits' NOT NULL,
	"price_per_unit" numeric DEFAULT '0' NOT NULL,
	"gross_quantity" numeric DEFAULT '0' NOT NULL,
	"discount_quantity" numeric DEFAULT '0' NOT NULL,
	"net_quantity" numeric DEFAULT '0' NOT NULL,
	"gross_amount" numeric DEFAULT '0' NOT NULL,
	"discount_amount" numeric DEFAULT '0' NOT NULL,
	"net_amount" numeric DEFAULT '0' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_fact_ai_credit_period" ON "fact_ai_credit_usage" ("enterprise_slug","period_year","period_month");--> statement-breakpoint
CREATE INDEX "idx_fact_ai_credit_model" ON "fact_ai_credit_usage" ("model");
