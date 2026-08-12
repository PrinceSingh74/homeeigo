/**
 * Verify zero overlapping active bookings (Phase 4).
 * Usage: bun --env-file=.env run scripts/verify-booking-overlaps.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const overlaps = await prisma.$queryRaw<
    Array<{ booking1: string; booking2: string; provider_id: string }>
  >`
    SELECT b1.id AS booking1, b2.id AS booking2, b1.provider_id
    FROM bookings b1
    JOIN bookings b2 ON b1.provider_id = b2.provider_id
      AND b1.id < b2.id
      AND b1.status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
      AND b2.status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
      AND b1.provider_id IS NOT NULL
    WHERE b1.provider_slot_start < b2.provider_slot_end
      AND b2.provider_slot_start < b1.provider_slot_end
  `;

  console.log(
    JSON.stringify(
      { overlapCount: overlaps.length, overlaps, pass: overlaps.length === 0 },
      null,
      2,
    ),
  );

  if (overlaps.length > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
