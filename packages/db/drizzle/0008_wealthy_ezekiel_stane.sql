CREATE TYPE "public"."vendor_verification_method" AS ENUM('invitation', 'code');--> statement-breakpoint
CREATE TYPE "public"."vendor_verification_status" AS ENUM('open', 'awaiting_second', 'verified', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "vendor_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"vendor_name" text NOT NULL,
	"contact_note" text NOT NULL,
	"token_hash" text NOT NULL,
	"terms" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_seal" text,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "vendor_invitations_token_hash_format" CHECK ("vendor_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "vendor_invitations_seal_format" CHECK ("vendor_invitations"."accepted_seal" is null or "vendor_invitations"."accepted_seal" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "vendor_invitations_single_terminal_state" CHECK (not ("vendor_invitations"."accepted_at" is not null and "vendor_invitations"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "vendor_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"seal" text,
	"method" "vendor_verification_method" NOT NULL,
	"status" "vendor_verification_status" DEFAULT 'open' NOT NULL,
	"raised_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"second_by" uuid,
	"code_hmac" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"contacted" text,
	"channel" text,
	"cap" numeric(78, 0),
	"invoice_fingerprint" text,
	"invitation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_verifications_seal_format" CHECK ("vendor_verifications"."seal" is null or "vendor_verifications"."seal" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "vendor_verifications_fingerprint_format" CHECK ("vendor_verifications"."invoice_fingerprint" is null or "vendor_verifications"."invoice_fingerprint" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "vendor_verifications_nonnegative_attempts" CHECK ("vendor_verifications"."attempts" between 0 and 5),
	CONSTRAINT "vendor_verifications_second_is_distinct" CHECK ("vendor_verifications"."second_by" is null or ("vendor_verifications"."second_by" <> "vendor_verifications"."raised_by" and ("vendor_verifications"."confirmed_by" is null or "vendor_verifications"."second_by" <> "vendor_verifications"."confirmed_by"))),
	CONSTRAINT "vendor_verifications_code_fields" CHECK ("vendor_verifications"."method" <> 'code' or ("vendor_verifications"."code_hmac" is not null and "vendor_verifications"."expires_at" is not null and "vendor_verifications"."seal" is not null))
);
--> statement-breakpoint
ALTER TABLE "vendor_invitations" ADD CONSTRAINT "vendor_invitations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invitations" ADD CONSTRAINT "vendor_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_verifications" ADD CONSTRAINT "vendor_verifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_verifications" ADD CONSTRAINT "vendor_verifications_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_verifications" ADD CONSTRAINT "vendor_verifications_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_verifications" ADD CONSTRAINT "vendor_verifications_second_by_users_id_fk" FOREIGN KEY ("second_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_verifications" ADD CONSTRAINT "vendor_verifications_invitation_id_vendor_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."vendor_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_invitations_token_hash_key" ON "vendor_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "vendor_invitations_business_idx" ON "vendor_invitations" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "vendor_verifications_business_idx" ON "vendor_verifications" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_verifications_open_code_key" ON "vendor_verifications" USING btree ("business_id","seal") WHERE "vendor_verifications"."method" = 'code' and "vendor_verifications"."status" in ('open', 'awaiting_second');