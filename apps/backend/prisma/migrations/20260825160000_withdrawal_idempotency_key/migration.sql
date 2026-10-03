-- Optional client idempotency for partner withdrawal retries (NULL allowed; unique among set keys).
ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_idempotency_key_key" ON "withdrawals"("idempotency_key");
