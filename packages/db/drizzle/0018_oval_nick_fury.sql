ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_key" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_len" CHECK ("users"."display_name" is null or (length("users"."display_name") >= 1 and length("users"."display_name") <= 80));