CREATE TABLE "recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seal" text NOT NULL,
	"business_id" uuid,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_invoices" (
	"series_id" uuid NOT NULL,
	"period" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"envelope" text NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "series_invoices_series_id_period_pk" PRIMARY KEY("series_id","period")
);
--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_invoices" ADD CONSTRAINT "series_invoices_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "series_invoices_fp" ON "series_invoices" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "series_invoices_due" ON "series_invoices" USING btree ("release_at");