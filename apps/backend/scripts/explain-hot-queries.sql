-- EXPLAIN ANALYZE for the six hottest query shapes.
\echo === 1. Booking search (catalog list) ===
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM services WHERE is_active = true ORDER BY popularity DESC LIMIT 20;

\echo === 2. Booking create: provider slot-conflict probe ===
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM bookings
WHERE provider_id = (SELECT id FROM providers LIMIT 1)
  AND status IN ('PENDING','ACCEPTED','IN_PROGRESS')
  AND scheduled_date >= now() - interval '1 day';

\echo === 3. Booking update: row lock by id ===
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM bookings WHERE id = (SELECT id FROM bookings LIMIT 1) FOR UPDATE;

\echo === 4. Wallet verify: pending top-up by reference ===
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM wallet_transactions WHERE reference_id = 'order_xyz' AND reference_type = 'razorpay_order' AND status = 'PENDING';

\echo === 5. Payment verify: by razorpay_order_id ===
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM payments WHERE razorpay_order_id = 'order_xyz';

\echo === 6. Gift card redeem: by code ===
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM gift_cards WHERE code = 'GCTEST123';

\echo === Index inventory on hot tables ===
SELECT tablename, indexname FROM pg_indexes
WHERE tablename IN ('services','bookings','payments','wallet_transactions','gift_cards')
ORDER BY tablename, indexname;

\echo === Lock / deadlock counters ===
SELECT datname, deadlocks, conflicts, temp_files, blks_hit, blks_read
FROM pg_stat_database WHERE datname = 'homigo_db';
