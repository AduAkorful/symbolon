CREATE TABLE "vendor_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"seal" text NOT NULL,
	"kind" text NOT NULL,
	"message" jsonb NOT NULL,
	"signature" text NOT NULL,
	"fingerprint" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_requests_kind" CHECK ("vendor_requests"."kind" in ('payout_change', 'seal_rotation', 'cancel', 'credit_note')),
	CONSTRAINT "vendor_requests_status" CHECK ("vendor_requests"."status" in ('pending', 'confirmed', 'rejected', 'applied'))
);
--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_requests_business_status" ON "vendor_requests" USING btree ("business_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_requests_signature_key" ON "vendor_requests" USING btree ("signature");