-- F2 — a refund whose gateway outcome is unknown must not be recorded as a failure.
--
-- A transport fault (timeout, connection reset, lost response) proves nothing: the request may
-- have reached Razorpay and been applied. Recording that as FAILED both reverts the payment to a
-- refundable state and tells an operator "nothing happened", which is how the same refund gets
-- issued twice. INDETERMINATE preserves the uncertainty until reconciliation resolves it.
--
-- Additive only. No existing row changes status, and no financial table is altered.
ALTER TYPE "RefundRequestStatus" ADD VALUE IF NOT EXISTS 'INDETERMINATE';
