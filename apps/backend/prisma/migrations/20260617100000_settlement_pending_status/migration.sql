-- Add SETTLEMENT_PENDING for payments awaiting gateway settlement (< threshold days)
ALTER TYPE "ReconciliationStatus" ADD VALUE IF NOT EXISTS 'SETTLEMENT_PENDING' BEFORE 'SETTLEMENT_MISMATCH';
