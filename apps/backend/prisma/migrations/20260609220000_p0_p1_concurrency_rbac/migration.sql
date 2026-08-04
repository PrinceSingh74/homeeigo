-- P0/P1: wallet indexes, payment idempotency, booking provider-slot guard

CREATE INDEX IF NOT EXISTS "wallet_transactions_reference_id_idx" ON "wallet_transactions"("reference_id");
CREATE INDEX IF NOT EXISTS "hcoin_transactions_reference_id_idx" ON "hcoin_transactions"("reference_id");

-- Payment order idempotency (one Razorpay order per booking intent)
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

UPDATE "payments"
SET "idempotency_key" = 'booking_order:' || "booking_id"
WHERE "idempotency_key" IS NULL;

ALTER TABLE "payments" ALTER COLUMN "idempotency_key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- Prevent duplicate active bookings for same provider at exact scheduled time
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_provider_scheduled_active_key"
ON "bookings"("provider_id", "scheduled_date")
WHERE "provider_id" IS NOT NULL
  AND "status" IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS');
