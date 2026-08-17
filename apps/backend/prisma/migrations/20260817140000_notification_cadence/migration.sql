-- Phase 6C — cadence domain. Additive only: two new tables, no change to anything that exists.

CREATE TABLE IF NOT EXISTS "notification_cadence_windows" (
  "id"             TEXT         NOT NULL,
  "recipient_type" TEXT         NOT NULL,
  "recipient_id"   TEXT         NOT NULL,
  -- The recipient's local calendar day as plain YYYY-MM-DD text. The day is decided in the
  -- recipient's timezone before it gets here, and text means no session timezone can shift it.
  "window_date"    TEXT         NOT NULL,
  "timezone"       TEXT         NOT NULL,
  "used"           INTEGER      NOT NULL DEFAULT 0,
  "cap"            INTEGER      NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_cadence_windows_pkey" PRIMARY KEY ("id")
);

-- The unique key is what makes the reservation atomic: concurrent workers collide here and are
-- serialised by the index rather than by a read-compare-write that they could all pass.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_cadence_windows_recipient_day_key"
  ON "notification_cadence_windows" ("recipient_type", "recipient_id", "window_date");

CREATE INDEX IF NOT EXISTS "notification_cadence_windows_window_date_idx"
  ON "notification_cadence_windows" ("window_date");

CREATE TABLE IF NOT EXISTS "notification_cadence_reservations" (
  "id"                TEXT         NOT NULL,
  "idempotency_key"   TEXT         NOT NULL,
  "recipient_type"    TEXT         NOT NULL,
  "recipient_id"      TEXT         NOT NULL,
  "window_date"       TEXT         NOT NULL,
  "slot_no"           INTEGER      NOT NULL,
  "workflow_id"       TEXT,
  "workflow_version"  INTEGER,
  "notification_type" TEXT         NOT NULL,
  "category"          "NotificationCategory" NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_cadence_reservations_pkey" PRIMARY KEY ("id")
);

-- A replayed notification operation must not take a second slot.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_cadence_reservations_idempotency_key_key"
  ON "notification_cadence_reservations" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "notification_cadence_reservations_recipient_day_idx"
  ON "notification_cadence_reservations" ("recipient_type", "recipient_id", "window_date");

-- Serves workflow cooldown lookups, which NotificationDelivery cannot answer: it does not record
-- which workflow asked for the message.
CREATE INDEX IF NOT EXISTS "notification_cadence_reservations_workflow_idx"
  ON "notification_cadence_reservations" ("workflow_id", "recipient_type", "recipient_id", "created_at");
