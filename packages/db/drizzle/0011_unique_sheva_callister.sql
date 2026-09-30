ALTER TABLE "deliveries" ADD COLUMN "state" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "tx_hash" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "hold_source" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "open_tx" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "closed_tx" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_state" CHECK ("deliveries"."state" in ('confirmed', 'rejected'));--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_reason_only_on_rejection" CHECK ("deliveries"."state" = 'rejected' or "deliveries"."reason" is null);--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tx_hash_format" CHECK ("deliveries"."tx_hash" is null or "deliveries"."tx_hash" ~ '^0x[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_hold_source" CHECK ("invoices"."hold_source" is null or "invoices"."hold_source" in ('steward', 'human'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_hold_source_with_status" CHECK ("invoices"."status" = 'held' or "invoices"."hold_source" is null);--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_open_tx_format" CHECK ("purchase_orders"."open_tx" is null or "purchase_orders"."open_tx" ~ '^0x[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_tx_format" CHECK ("purchase_orders"."closed_tx" is null or "purchase_orders"."closed_tx" ~ '^0x[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_consistent" CHECK (("purchase_orders"."closed_at" is null) = ("purchase_orders"."closed_tx" is null));