CREATE TABLE "budgets" (
	"business_id" uuid NOT NULL,
	"budget_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_business_id_budget_id_pk" PRIMARY KEY("business_id","budget_id"),
	CONSTRAINT "budgets_budget_id_format" CHECK ("budgets"."budget_id" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"budgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "team_invitations_token_hash_format" CHECK ("team_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "team_invitations_role_not_owner" CHECK ("team_invitations"."role" in ('approver', 'requester', 'viewer')),
	CONSTRAINT "team_invitations_single_terminal_state" CHECK (not ("team_invitations"."accepted_at" is not null and "team_invitations"."revoked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_business_name_lower_key" ON "budgets" USING btree ("business_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_token_hash_key" ON "team_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "team_invitations_business_idx" ON "team_invitations" USING btree ("business_id","created_at");