CREATE TABLE "vendor_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seal" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"vault" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_clients_identifier" CHECK ("vendor_clients"."vault" is not null or "vendor_clients"."email" is not null),
	CONSTRAINT "vendor_clients_vault_format" CHECK ("vendor_clients"."vault" is null or "vendor_clients"."vault" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "vendor_clients_email_lowercase" CHECK ("vendor_clients"."email" is null or "vendor_clients"."email" = lower("vendor_clients"."email"))
);
--> statement-breakpoint
ALTER TABLE "seals" ADD COLUMN "payout_address" text;--> statement-breakpoint
ALTER TABLE "vendor_clients" ADD CONSTRAINT "vendor_clients_seal_seals_address_fk" FOREIGN KEY ("seal") REFERENCES "public"."seals"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_clients_seal" ON "vendor_clients" USING btree ("seal");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_clients_seal_vault" ON "vendor_clients" USING btree ("seal","vault");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_clients_seal_email" ON "vendor_clients" USING btree ("seal","email");--> statement-breakpoint
ALTER TABLE "seals" ADD CONSTRAINT "seals_payout_format" CHECK ("seals"."payout_address" is null or "seals"."payout_address" ~ '^0x[0-9a-f]{40}$');