CREATE TABLE "screenings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"seal" text NOT NULL,
	"address" text NOT NULL,
	"risk" smallint NOT NULL,
	"result" text NOT NULL,
	"rule_name" text,
	"actions" text[] DEFAULT '{}' NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"provider" text NOT NULL,
	"screened_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenings_seal_format" CHECK ("screenings"."seal" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "screenings_address_format" CHECK ("screenings"."address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "screenings_risk_range" CHECK ("screenings"."risk" between 0 and 3),
	CONSTRAINT "screenings_result_check" CHECK ("screenings"."result" in ('APPROVED', 'DENIED'))
);
--> statement-breakpoint
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screenings_business_seal_idx" ON "screenings" USING btree ("business_id","seal");--> statement-breakpoint
CREATE INDEX "screenings_business_screened_idx" ON "screenings" USING btree ("business_id","screened_at");