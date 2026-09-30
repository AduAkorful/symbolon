ALTER TABLE "early_pay_offers" DROP CONSTRAINT "early_pay_offers_status";--> statement-breakpoint
ALTER TABLE "vendor_requests" DROP CONSTRAINT "vendor_requests_status";--> statement-breakpoint
DROP INDEX "vendor_requests_signature_key";--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_requests_business_signature" ON "vendor_requests" USING btree ("business_id","signature");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_requests_null_business_signature" ON "vendor_requests" USING btree ("signature") WHERE "vendor_requests"."business_id" is null;--> statement-breakpoint
ALTER TABLE "early_pay_offers" ADD CONSTRAINT "early_pay_offers_status" CHECK ("early_pay_offers"."status" in ('open', 'accepted', 'countered', 'declined', 'expired', 'used', 'withdrawn'));--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_status" CHECK ("vendor_requests"."status" in ('pending', 'confirmed', 'rejected', 'applied', 'cancelled'));