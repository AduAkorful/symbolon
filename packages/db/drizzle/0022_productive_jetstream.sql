CREATE TABLE "lending_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"venue" text NOT NULL,
	"block_number" bigint NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"share_decimals" smallint NOT NULL,
	"assets" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lending_samples_venue_format" CHECK ("lending_samples"."venue" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lending_samples_venue_block_uq" ON "lending_samples" USING btree ("chain_id","venue","block_number");--> statement-breakpoint
CREATE INDEX "lending_samples_venue_time_idx" ON "lending_samples" USING btree ("chain_id","venue","sampled_at");