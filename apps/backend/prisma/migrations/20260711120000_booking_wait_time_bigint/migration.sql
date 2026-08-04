-- wait_time_ms values in milliseconds can exceed INT4 max (~24.8 days), causing accept failures.
ALTER TABLE "bookings" ALTER COLUMN "wait_time_ms" TYPE BIGINT USING "wait_time_ms"::BIGINT;
ALTER TABLE "bookings" ALTER COLUMN "estimated_wait_time_ms" TYPE BIGINT USING "estimated_wait_time_ms"::BIGINT;
