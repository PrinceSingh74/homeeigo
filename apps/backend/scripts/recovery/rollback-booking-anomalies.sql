-- ============================================================================
-- HOMIGO — Forensic Repair ROLLBACK (pure SQL)
-- Reverts ONLY the rows this recovery changed (proven via forensic_recovery_log),
-- and only if they are still in the post-repair value. Idempotent · Serializable.
--
-- Run:  docker exec -i homigo-postgres psql -U postgres -d homigo_db -v ON_ERROR_STOP=1 \
--          < scripts/recovery/rollback-booking-anomalies.sql
--
-- NOTE: CLASS C (HOMIGO-20260611-00004) was re-dispatched after repair. Rolling it back to
-- ACCEPTED re-introduces the no-provider anomaly — only do so for a deliberate emergency revert.
-- ============================================================================
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- CLASS A — restore payment_status PENDING -> SUCCESS (only rows we logged + still PENDING).
WITH logged AS (
  SELECT DISTINCT booking_id FROM forensic_recovery_log WHERE operation = 'REPAIR_CLASS_A'
),
rb AS (
  UPDATE bookings SET payment_status = 'SUCCESS'::"PaymentStatus", updated_at = now()
  WHERE id IN (SELECT booking_id FROM logged)
    AND payment_status = 'PENDING'::"PaymentStatus"
  RETURNING id, booking_number, payment_status::text AS v
)
INSERT INTO forensic_recovery_log (operation, booking_id, booking_number, field, old_value, new_value, reason)
SELECT 'ROLLBACK_CLASS_A', id, booking_number, 'payment_status', 'PENDING', 'SUCCESS', 'manual rollback' FROM rb;

-- CLASS C — restore status PENDING -> ACCEPTED (only the logged booking, still PENDING).
WITH logged AS (
  SELECT DISTINCT booking_id FROM forensic_recovery_log WHERE operation = 'REPAIR_CLASS_C'
),
rb AS (
  UPDATE bookings SET status = 'ACCEPTED'::"BookingStatus", updated_at = now()
  WHERE id IN (SELECT booking_id FROM logged)
    AND status = 'PENDING'::"BookingStatus"
  RETURNING id, booking_number
)
INSERT INTO forensic_recovery_log (operation, booking_id, booking_number, field, old_value, new_value, reason)
SELECT 'ROLLBACK_CLASS_C', id, booking_number, 'status', 'PENDING', 'ACCEPTED', 'manual rollback' FROM rb;

SELECT operation, booking_number, field, old_value, new_value
FROM forensic_recovery_log
WHERE operation LIKE 'ROLLBACK%' AND run_at > now() - interval '30 seconds'
ORDER BY id;

COMMIT;
