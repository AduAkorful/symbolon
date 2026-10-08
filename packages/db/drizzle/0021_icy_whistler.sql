DROP INDEX "ask_messages_thread";--> statement-breakpoint
ALTER TABLE "ask_messages" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
CREATE INDEX "ask_messages_thread" ON "ask_messages" USING btree ("business_id","user_id","conversation_id","created_at");