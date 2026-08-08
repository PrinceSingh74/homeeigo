/**
 * Re-validates stored ETA labels against the authoritative training contract.
 *
 * Needed once, after the contract was aligned: labels written under the older rules may
 * carry TRAINING_READY while falling outside the 60s..MAX_TRAVEL_SEC window. This applies
 * the current validator to existing rows — it recomputes status and quality from data
 * already present and never invents, fabricates or deletes a label.
 *
 * Also re-syncs the affected rows to BigQuery so both layers report the same status.
 *
 *   bun --env-file=.env run scripts/eta-revalidate-labels.ts            # dry run
 *   bun --env-file=.env run scripts/eta-revalidate-labels.ts --apply
 */
import prisma from "../src/lib/prisma";
import { validateEtaLabel } from "../analytics/eta/validation";
import { etaIntelligenceService } from "../src/services/eta-intelligence.service";

const APPLY = process.argv.includes("--apply");
const L = (s: string) => console.log("\n" + "=".repeat(78) + "\n" + s + "\n" + "=".repeat(78));

const labels = await prisma.etaTrainingLabel.findMany();
const bookings = await prisma.booking.findMany({
  where: { id: { in: labels.map((l) => l.bookingId) } },
  select: { id: true, bookingNumber: true },
});
const numberById = new Map(bookings.map((b) => [b.id, b.bookingNumber]));

type Change = {
  bookingId: string;
  bookingNumber: string;
  fromStatus: string;
  toStatus: string;
  fromQuality: number;
  toQuality: number;
  reasons: string[];
};

const changes: Change[] = [];
const unchanged: string[] = [];

for (const l of labels) {
  const f = (l.features ?? {}) as Record<string, unknown>;
  const arrivalSource =
    f.arrivalSource === "job_start" || f.arrivalSource === "gps_geofence" ? f.arrivalSource : undefined;

  const result = validateEtaLabel({
    bookingId: l.bookingId,
    dispatchTimestamp: l.dispatchTimestamp,
    arrivalTimestamp: l.arrivalTimestamp,
    actualTravelDurationSec: l.actualTravelDurationSec,
    pickupLatitude: l.pickupLatitude,
    pickupLongitude: l.pickupLongitude,
    partnerLatArrival: l.partnerLatArrival,
    partnerLngArrival: l.partnerLngArrival,
    travelDistanceMeters: l.travelDistanceMeters,
    googleEtaSeconds: l.googleEtaSeconds,
    arrivalSource,
  });

  const bookingNumber = numberById.get(l.bookingId) ?? l.bookingId;
  if (result.status !== l.status || result.qualityScore !== l.qualityScore) {
    changes.push({
      bookingId: l.bookingId,
      bookingNumber,
      fromStatus: l.status,
      toStatus: result.status,
      fromQuality: l.qualityScore,
      toQuality: result.qualityScore,
      reasons: result.rejectionReasons,
    });
  } else {
    unchanged.push(bookingNumber);
  }
}

L("RE-VALIDATION PLAN");
console.log(`  labels examined : ${labels.length}`);
console.log(`  would change    : ${changes.length}`);
console.log(`  unchanged       : ${unchanged.length}\n`);
for (const c of changes) {
  console.log(`  ${c.bookingNumber.padEnd(30)} ${c.fromStatus} (q=${c.fromQuality}) -> ${c.toStatus} (q=${c.toQuality})`);
  console.log(`     reasons: ${c.reasons.join(", ") || "none"}`);
}
for (const u of unchanged) console.log(`  ${u.padEnd(30)} unchanged`);

if (!APPLY) {
  console.log("\n  DRY RUN — pass --apply to persist\n");
  process.exit(0);
}

L("APPLYING");
for (const c of changes) {
  await prisma.etaTrainingLabel.update({
    where: { bookingId: c.bookingId },
    data: {
      status: c.toStatus as never,
      qualityScore: c.toQuality,
      rejectionReason: c.reasons.length ? c.reasons.join(",") : null,
    },
  });
  console.log(`  ${c.bookingNumber}: ${c.fromStatus} -> ${c.toStatus}`);
}

L("RE-SYNCING AFFECTED LABELS TO BIGQUERY");
// Uses the normal collection path so the warehouse MERGE, provenance and synthetic
// classification all apply exactly as they do in production.
for (const c of changes) {
  await etaIntelligenceService.resyncLabelToWarehouse(c.bookingId);
  console.log(`  ${c.bookingNumber}: warehouse re-synced`);
}

L("RESULT");
const after = await prisma.etaTrainingLabel.groupBy({ by: ["status"], _count: { id: true } });
console.log("  labels by status:", Object.fromEntries(after.map((r) => [r.status, r._count.id])));
process.exit(0);
