ALTER TABLE "invoices" ADD COLUMN "inbox_trust" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency_off" boolean;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_inbox_trust" CHECK ("inbox_trust" is null or "inbox_trust" in ('verified', 'new_vendor', 'blocked', 'failed'));
--> statement-breakpoint
ALTER TABLE "steward_runs" DROP CONSTRAINT "steward_runs_status_check";
--> statement-breakpoint
ALTER TABLE "steward_runs" ADD CONSTRAINT "steward_runs_status_check" CHECK ("status" in ('queued', 'running', 'done', 'failed', 'skipped_paused', 'skipped_fees'));
