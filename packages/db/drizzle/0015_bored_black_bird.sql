CREATE TYPE "public"."queued_change_status" AS ENUM('queued', 'applied', 'cancelled');--> statement-breakpoint
CREATE TABLE "queued_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"change_id" text NOT NULL,
	"selector" text NOT NULL,
	"calldata" text,
	"summary" jsonb NOT NULL,
	"created_by" uuid,
	"eta" timestamp with time zone NOT NULL,
	"status" "queued_change_status" DEFAULT 'queued' NOT NULL,
	"queue_tx" text,
	"applied_tx" text,
	"cancelled_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queued_changes_change_id_format" CHECK ("queued_changes"."change_id" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "queued_changes_selector_format" CHECK ("queued_changes"."selector" ~ '^0x[0-9a-f]{8}$')
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "buffer_days" integer;--> statement-breakpoint
ALTER TABLE "queued_changes" ADD CONSTRAINT "queued_changes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_changes" ADD CONSTRAINT "queued_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "queued_changes_business_change_id_key" ON "queued_changes" USING btree ("business_id","change_id");--> statement-breakpoint
CREATE INDEX "queued_changes_business_status_idx" ON "queued_changes" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "queued_changes_business_eta_idx" ON "queued_changes" USING btree ("business_id","eta");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_buffer_days_check" CHECK ("businesses"."buffer_days" is null or ("businesses"."buffer_days" >= 1 and "businesses"."buffer_days" <= 90));