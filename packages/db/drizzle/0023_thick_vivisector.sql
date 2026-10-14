ALTER TYPE "public"."invoice_status" ADD VALUE 'declined';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "declined_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_declined_reason" CHECK ("invoices"."status"::text <> 'declined' or "invoices"."declined_reason" is not null);