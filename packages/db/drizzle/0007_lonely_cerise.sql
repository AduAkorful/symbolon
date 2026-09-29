CREATE TABLE "unsigned_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"extraction" jsonb NOT NULL,
	"assessment" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unsigned_bills_file_hash_format" CHECK ("unsigned_bills"."file_sha256" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "unsigned_bills_status" CHECK ("unsigned_bills"."status" in ('open', 'invited', 'fraud', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "unsigned_bills" ADD CONSTRAINT "unsigned_bills_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsigned_bills" ADD CONSTRAINT "unsigned_bills_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unsigned_bills_business_file" ON "unsigned_bills" USING btree ("business_id","file_sha256");--> statement-breakpoint
CREATE INDEX "unsigned_bills_business_status" ON "unsigned_bills" USING btree ("business_id","status");