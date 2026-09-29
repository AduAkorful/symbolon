CREATE TYPE "public"."invoice_status" AS ENUM('received', 'rejected', 'verified', 'held', 'awaiting_approval', 'scheduled', 'partially_paid', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'approver', 'requester', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."payee_status" AS ENUM('invited', 'pending_verification', 'verified', 'blocked', 'retired');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"credit" numeric(78, 0) NOT NULL,
	"signer" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"chain_id" integer NOT NULL,
	"vault" text,
	"steward_wallet" text,
	"steward_mode" text DEFAULT 'shadow' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_vault_format" CHECK ("businesses"."vault" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "businesses_steward_mode" CHECK ("businesses"."steward_mode" in ('shadow', 'assist', 'auto'))
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"address" text NOT NULL,
	"event_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_events_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "decision_anchors" (
	"root" text PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"count" integer NOT NULL,
	"leaves" jsonb NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text,
	"record" jsonb NOT NULL,
	"hash" text NOT NULL,
	"tx_hash" text,
	"supersedes" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"confirmed_by" uuid,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "early_pay_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"discount_bps" integer NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"signature" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "early_pay_offers_bps" CHECK ("early_pay_offers"."discount_bps" between 1 and 5000),
	CONSTRAINT "early_pay_offers_status" CHECK ("early_pay_offers"."status" in ('open', 'accepted', 'countered', 'declined', 'expired', 'used'))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"ledger" text NOT NULL,
	"seal" text NOT NULL,
	"business_id" uuid,
	"payer_ref" text NOT NULL,
	"invoice_number" text NOT NULL,
	"token" text NOT NULL,
	"total" numeric(78, 0) NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"po_ref" text,
	"replaces" text,
	"envelope" text NOT NULL,
	"status" "invoice_status" DEFAULT 'received' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credited" numeric(78, 0) DEFAULT 0 NOT NULL,
	"synced_block" bigint,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_fingerprint_format" CHECK ("invoices"."fingerprint" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "invoices_seal_format" CHECK ("invoices"."seal" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "invoices_source" CHECK ("invoices"."source" in ('link', 'email', 'upload', 'api', 'recurring')),
	CONSTRAINT "invoices_amounts" CHECK ("invoices"."total" > 0 and "invoices"."credited" >= 0 and "invoices"."credited" <= "invoices"."total")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"budgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_business_id_user_id_pk" PRIMARY KEY("business_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text,
	"body" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"sent_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payees" (
	"business_id" uuid NOT NULL,
	"seal" text NOT NULL,
	"status" "payee_status" DEFAULT 'pending_verification' NOT NULL,
	"verification_method" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payees_business_id_seal_pk" PRIMARY KEY("business_id","seal"),
	CONSTRAINT "payees_seal_format" CHECK ("payees"."seal" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "payees_verified_has_method" CHECK ("payees"."status" <> 'verified' or ("payees"."verification_method" is not null and "payees"."verified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"business_id" uuid NOT NULL,
	"po_ref" text NOT NULL,
	"po_number" text NOT NULL,
	"seal" text NOT NULL,
	"budget" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"description" text,
	"kind" text DEFAULT 'one_off' NOT NULL,
	"release_after" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_business_id_po_ref_pk" PRIMARY KEY("business_id","po_ref"),
	CONSTRAINT "purchase_orders_kind" CHECK ("purchase_orders"."kind" in ('one_off', 'recurring', 'milestone'))
);
--> statement-breakpoint
CREATE TABLE "seals" (
	"address" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text,
	"website" text,
	"verified_domain" text,
	"rotated_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seals_address_format" CHECK ("seals"."address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "seals_handle_format" CHECK ("seals"."handle" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"key" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"wallet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_wallet_format" CHECK ("users"."wallet" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_anchors" ADD CONSTRAINT "decision_anchors_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seals" ADD CONSTRAINT "seals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_unique" ON "approvals" USING btree ("business_id","fingerprint","signer","credit");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_vault_key" ON "businesses" USING btree ("chain_id","vault");--> statement-breakpoint
CREATE INDEX "chain_events_address_block" ON "chain_events" USING btree ("address","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_hash_key" ON "decisions" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "decisions_business_time" ON "decisions" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_subject" ON "decisions" USING btree ("subject");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_business_fp" ON "deliveries" USING btree ("business_id","fingerprint");--> statement-breakpoint
CREATE INDEX "early_pay_offers_fp" ON "early_pay_offers" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "invoices_business_status" ON "invoices" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "invoices_seal" ON "invoices" USING btree ("seal");--> statement-breakpoint
CREATE INDEX "invoices_seal_number" ON "invoices" USING btree ("seal","invoice_number");--> statement-breakpoint
CREATE INDEX "notifications_user_unread" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seals_handle_key" ON "seals" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_key" ON "users" USING btree ("wallet");