ALTER TABLE "auth_challenges" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "auth_challenges" CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "method" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."session_method";--> statement-breakpoint
CREATE TYPE "public"."session_method" AS ENUM('privy');--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "method" SET DATA TYPE "public"."session_method" USING "method"::"public"."session_method";--> statement-breakpoint
DROP INDEX "users_circle_user_key";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privy_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_privy_user_key" ON "users" USING btree ("privy_user_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "circle_user_id";--> statement-breakpoint
DROP TYPE "public"."challenge_kind";