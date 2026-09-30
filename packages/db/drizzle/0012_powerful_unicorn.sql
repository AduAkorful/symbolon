CREATE TABLE "steward_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"started_by" uuid,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "steward_runs_trigger_check" CHECK ("steward_runs"."trigger" in ('manual', 'schedule')),
	CONSTRAINT "steward_runs_mode_check" CHECK ("steward_runs"."mode" in ('shadow', 'assist', 'auto')),
	CONSTRAINT "steward_runs_status_check" CHECK ("steward_runs"."status" in ('running', 'done', 'failed', 'skipped_paused', 'skipped_fees'))
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "early_pay" jsonb;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "vault_block" bigint;--> statement-breakpoint
ALTER TABLE "steward_runs" ADD CONSTRAINT "steward_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steward_runs" ADD CONSTRAINT "steward_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "steward_runs_active_unique" ON "steward_runs" USING btree ("business_id") WHERE "steward_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "steward_runs_business_started_idx" ON "steward_runs" USING btree ("business_id","started_at");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_vault_block_check" CHECK ("businesses"."vault_block" is null or "businesses"."vault_block" >= 0);