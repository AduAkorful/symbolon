CREATE TABLE "prepared_payments" (
	"business_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prepared_payments_business_id_hash_pk" PRIMARY KEY("business_id","hash")
);
--> statement-breakpoint
ALTER TABLE "prepared_payments" ADD CONSTRAINT "prepared_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;