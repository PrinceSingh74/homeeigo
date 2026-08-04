/** Remove prior Stage-D certification bookings for idempotent re-runs. */
const { PrismaClient } = require("/app/node_modules/@prisma/client");
const p = new PrismaClient();
const USER_ID = "usr_stage_d_seed_v1";

const STEPS = [
  `DELETE FROM event_consumer_receipts WHERE event_id IN (
     SELECT event_id FROM event_outbox WHERE aggregate_id IN (
       SELECT id::text FROM bookings WHERE user_id = '${USER_ID}'))`,
  `DELETE FROM event_dead_letters WHERE event_id IN (
     SELECT event_id FROM event_outbox WHERE aggregate_id IN (
       SELECT id::text FROM bookings WHERE user_id = '${USER_ID}'))`,
  `DELETE FROM event_outbox WHERE aggregate_id IN (
     SELECT id::text FROM bookings WHERE user_id = '${USER_ID}')`,
  `DELETE FROM assignment_attempts WHERE job_id IN (
     SELECT id FROM assignment_jobs WHERE booking_id IN (
       SELECT id FROM bookings WHERE user_id = '${USER_ID}'))`,
  `DELETE FROM assignment_jobs WHERE booking_id IN (
     SELECT id FROM bookings WHERE user_id = '${USER_ID}')`,
  `DELETE FROM bookings WHERE user_id = '${USER_ID}'`,
];

async function main() {
  for (const sql of STEPS) await p.$executeRawUnsafe(sql);
  const remaining = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = '${USER_ID}'`,
  );
  console.log(JSON.stringify({ cleanup: "done", userId: USER_ID, remaining: remaining[0]?.n ?? 0 }));
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
