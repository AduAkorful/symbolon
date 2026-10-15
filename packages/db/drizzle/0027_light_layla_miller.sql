CREATE TABLE "user_avatars" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"byte_size" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_avatars_type" CHECK ("user_avatars"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "user_avatars_size" CHECK ("user_avatars"."byte_size" > 0 and "user_avatars"."byte_size" <= 102400)
);
--> statement-breakpoint
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;