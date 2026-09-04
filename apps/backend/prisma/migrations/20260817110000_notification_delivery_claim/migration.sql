-- A delivery row is now written BEFORE any provider is called, so the idempotency key is claimed
-- by the unique index rather than by a read-then-write that concurrent processes can all pass.
--
-- PENDING is that claim window: the operation exists and is owned, nothing has been sent yet.
-- `updated_at` carries the claim's lease, so a process that dies mid-send leaves a row that can be
-- taken over instead of silently swallowing the notification forever.
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'QUEUED';

ALTER TABLE "notification_deliveries"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
