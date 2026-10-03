-- §27 / mandate M — durable per-payment environment truth.
-- Which Razorpay world (LIVE or TEST) each payment and each refund request actually moved
-- through, stamped from the credential in use at the time. NULL = UNKNOWN: historical rows
-- are never guessed at (no backfill here; a report-mode script fills only rows the dev-mock
-- gateway provably created). Additive only — no existing row is touched.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS environment TEXT;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_environment_check;

ALTER TABLE payments ADD CONSTRAINT payments_environment_check CHECK (environment IS NULL OR environment IN ('LIVE', 'TEST'));

CREATE INDEX IF NOT EXISTS idx_payments_environment ON payments (environment) WHERE environment IS NOT NULL;

ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS environment TEXT;

ALTER TABLE refund_requests DROP CONSTRAINT IF EXISTS refund_requests_environment_check;

ALTER TABLE refund_requests ADD CONSTRAINT refund_requests_environment_check CHECK (environment IS NULL OR environment IN ('LIVE', 'TEST'));

CREATE INDEX IF NOT EXISTS idx_refund_requests_environment ON refund_requests (environment) WHERE environment IS NOT NULL;
