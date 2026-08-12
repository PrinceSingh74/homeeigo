-- ============================================================================
-- HOMIGO — Forensic Booking/Payment Anomaly Repair (pure SQL)
-- Idempotent · Serializable · Self-auditing · Re-runnable · Zero financial drift
--
-- Run:  docker exec -i homigo-postgres psql -U postgres -d homigo_db -v ON_ERROR_STOP=1 \
--          < scripts/recovery/repair-booking-anomalies.sql
--   or:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/recovery/repair-booking-anomalies.sql
--
-- SAFETY: every UPDATE is GUARDED — it only fires when the row STILL matches the verified
-- anomaly profile (no money trail / null provider). Re-running on already-repaired data is a
-- clean no-op. Nothing is deleted, fabricated, or applied to money/ledger tables.
-- ============================================================================
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- Permanent evidence trail (idempotent).
CREATE TABLE IF NOT EXISTS forensic_recovery_log (
  id              bigserial PRIMARY KEY,
  run_at          timestamptz NOT NULL DEFAULT now(),
  operation       text NOT NULL,
  booking_id      text NOT NULL,
  booking_number  text,
  field           text NOT NULL,
  old_value       text,
  new_value       text,
  reason          text
);

-- ---------------------------------------------------------------------------
-- CLASS A — Phantom-SUCCESS test bookings (RC-*, FM-*): paymentStatus=SUCCESS
-- with ZERO money trail. Guard: still SUCCESS AND no Payment AND no completed WalletTxn.
-- Repair: payment_status -> PENDING (reflects reality: never paid).
-- ---------------------------------------------------------------------------
WITH targets AS (
  SELECT b.id, b.booking_number, b.payment_status::text AS old_value
  FROM bookings b
  WHERE b.id IN (
      'cmqe4q4gh000etzf003x9y8kq','cmqe4q4gx000itzf0fblr9ym4','cmqe4q4h6000mtzf0vrc3hni7',
      'cmqe6beyo000etz6c5r7gstae','cmqe6beza000itz6cykrq5o2m')
    AND b.payment_status = 'SUCCESS'::"PaymentStatus"
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)
    AND NOT EXISTS (SELECT 1 FROM wallet_transactions w
                    WHERE w.reference_id = b.id AND w.reference_type = 'booking_wallet_payment'
                      AND w.status = 'COMPLETED')
),
upd AS (
  UPDATE bookings SET payment_status = 'PENDING'::"PaymentStatus", updated_at = now()
  WHERE id IN (SELECT id FROM targets)
  RETURNING id
)
INSERT INTO forensic_recovery_log (operation, booking_id, booking_number, field, old_value, new_value, reason)
SELECT 'REPAIR_CLASS_A', t.id, t.booking_number, 'payment_status', t.old_value, 'PENDING',
       'phantom SUCCESS, zero money trail (synthetic test record)'
FROM targets t;

-- ---------------------------------------------------------------------------
-- CLASS C — Paid booking ACCEPTED with NULL provider (dispatch timeout left stale status).
-- Guard: still ACCEPTED AND provider_id IS NULL. Payment/ledger are REAL — untouched.
-- Repair: status -> PENDING so it re-dispatches.
-- ---------------------------------------------------------------------------
WITH target AS (
  SELECT b.id, b.booking_number, b.status::text AS old_value
  FROM bookings b
  WHERE b.booking_number = 'HOMIGO-20260611-00004'
    AND b.status = 'ACCEPTED'::"BookingStatus"
    AND b.provider_id IS NULL
),
upd AS (
  UPDATE bookings SET status = 'PENDING'::"BookingStatus", updated_at = now()
  WHERE id IN (SELECT id FROM target)
  RETURNING id
)
INSERT INTO forensic_recovery_log (operation, booking_id, booking_number, field, old_value, new_value, reason)
SELECT 'REPAIR_CLASS_C', t.id, t.booking_number, 'status', t.old_value, 'PENDING',
       'ACCEPTED with null provider (dispatch timeout); payment untouched'
FROM target t;

-- In-transaction verification (rows touched this run).
SELECT operation, booking_number, field, old_value, new_value
FROM forensic_recovery_log
WHERE run_at > now() - interval '30 seconds'
ORDER BY id;

COMMIT;
