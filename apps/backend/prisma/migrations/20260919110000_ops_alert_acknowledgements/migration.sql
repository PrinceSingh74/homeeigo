-- Server-side acknowledgement of live ops alerts (admin /alerts).
--
-- Ops-map alerts are computed live from booking/partner state, keyed by
-- "<TYPE>:<bookingId>:<providerId>". Acknowledgement used to live in one browser's localStorage:
-- invisible to every other admin, lost on a new browser, and with no record of who acknowledged.
-- One row per alert key; an acknowledgement covers the current occurrence and expires, so a
-- condition that is still present later alerts again.
--
-- Hand-scoped and additive: one new table, nothing existing touched.
CREATE TABLE IF NOT EXISTS "ops_alert_acknowledgements" (
    "alert_key" TEXT NOT NULL,
    "acknowledged_by" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "expires_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "ops_alert_acknowledgements_pkey" PRIMARY KEY ("alert_key"),
    CONSTRAINT "ops_alert_acknowledgements_key_len" CHECK (char_length("alert_key") BETWEEN 1 AND 300),
    CONSTRAINT "ops_alert_acknowledgements_window" CHECK ("expires_at" > "acknowledged_at")
);
CREATE INDEX IF NOT EXISTS "ops_alert_acknowledgements_expires_at_idx" ON "ops_alert_acknowledgements" ("expires_at");
