/**
 * ETA collection monitor — the "Telemetry monitoring" stage of the promotion path.
 *
 * Answers one question: is real ETA label collection actually progressing, and if not,
 * where is it stalling? Everything downstream of this stage waits on real trips, so this
 * is the only meaningful signal until the 50-label gate opens.
 *
 * READ-ONLY. Issues SELECTs only — no writes, no event emission, no training, no
 * promotion. Safe to run on a schedule.
 *
 *   bun --env-file=.env run scripts/eta-collection-monitor.ts
 *   bun --env-file=.env run scripts/eta-collection-monitor.ts --json
 */
import prisma from "../src/lib/prisma";
import { etaIntelligenceService } from "../src/services/eta-intelligence.service";
import { ETA_TRAINING_CONTRACT } from "../analytics/eta/validation";

const AS_JSON = process.argv.includes("--json");
const THRESHOLD = 50;
const SEGMENT_READY = 3333; // ~500 test rows at a 15% test split — see eta-model-promotion-path.md

const bar = (n: number, total: number, width = 34) => {
  const filled = Math.min(width, Math.round((n / total) * width));
  return "[" + "#".repeat(filled) + ".".repeat(width - filled) + "]";
};

// ── the authoritative count — never re-implemented here ───────────────────────
const eligible = await etaIntelligenceService.countTrainingEligible();

// ── capture funnel: where completed trips stop producing labels ───────────────
const [completed, withEnRoute, withArrived, withBoth, inWindow] = await Promise.all([
  prisma.booking.count({ where: { status: "COMPLETED" } }),
  prisma.booking.count({ where: { status: "COMPLETED", enRouteAt: { not: null } } }),
  prisma.booking.count({ where: { status: "COMPLETED", arrivedAt: { not: null } } }),
  prisma.booking.count({ where: { status: "COMPLETED", enRouteAt: { not: null }, arrivedAt: { not: null } } }),
  prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM bookings
    WHERE status = 'COMPLETED' AND en_route_at IS NOT NULL AND arrived_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (arrived_at - en_route_at)) BETWEEN ${ETA_TRAINING_CONTRACT.minTravelSec} AND ${ETA_TRAINING_CONTRACT.maxTravelSec}`,
]);
const durationOk = Number(inWindow[0].n);

// ── why labels are not becoming eligible ──────────────────────────────────────
const blocking = await prisma.$queryRaw<Array<{ reason: string; n: bigint }>>`
  SELECT COALESCE(rejection_reason, '(none)') AS reason, COUNT(*)::bigint AS n
  FROM eta_training_labels GROUP BY 1 ORDER BY 2 DESC`;

// ── provenance mix: is the explicit lifecycle actually being used? ────────────
const provenance = await prisma.$queryRaw<Array<{ source: string; n: bigint }>>`
  SELECT COALESCE(features->>'arrivalSource', '(unknown)') AS source, COUNT(*)::bigint AS n
  FROM eta_training_labels GROUP BY 1 ORDER BY 2 DESC`;

// ── throughput, to turn "0/50" into a date ────────────────────────────────────
const monthly = await prisma.$queryRaw<Array<{ month: string; n: bigint }>>`
  SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::bigint AS n
  FROM bookings WHERE status = 'COMPLETED'
  GROUP BY 1 ORDER BY 1 DESC LIMIT 4`;
const recent = monthly.filter((m) => Number(m.n) > 5).map((m) => Number(m.n));
const perMonth = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
// Only trips that clear the duration window can ever become labels.
const yieldRate = completed > 0 ? durationOk / completed : 0;
const labelsPerMonth = perMonth * yieldRate;
const monthsToGate = labelsPerMonth > 0 ? (THRESHOLD - eligible) / labelsPerMonth : null;
const monthsToSegment = labelsPerMonth > 0 ? (SEGMENT_READY - eligible) / labelsPerMonth : null;

// ── the diagnosis ─────────────────────────────────────────────────────────────
let diagnosis: string;
let action: string;
if (eligible >= THRESHOLD) {
  diagnosis = "GATE OPEN — the 50-label training threshold is met.";
  action = "Proceed to the real feature-contract audit, then real-vs-Google baseline.";
} else if (withBoth === 0) {
  diagnosis = "NO LIFECYCLE CAPTURE — not one completed trip has both timestamps.";
  action = "Partners are not using the explicit en-route/arrived actions. Verify the buttons are reachable in the shipped build.";
} else if (durationOk === 0) {
  diagnosis = "CAPTURE WORKS, DURATIONS TOO SHORT — timestamps land but every trip is under the 60s minimum.";
  action = "These are test taps, not real journeys. Real trips from real partners are required; no code change will help.";
} else if (durationOk > 0 && eligible === 0) {
  diagnosis = "TRIPS QUALIFY BUT NO LABEL IS ELIGIBLE — check the blocking reasons below.";
  action = "A qualifying trip is not converting into an eligible label. Inspect the collector and the synthetic classifier.";
} else {
  diagnosis = "COLLECTING — eligible labels are accumulating.";
  action = `Keep collecting. ${THRESHOLD - eligible} more to open the training gate.`;
}

const payload = {
  generatedAt: new Date().toISOString(),
  gate: { eligible, threshold: THRESHOLD, open: eligible >= THRESHOLD, segmentReadyAt: SEGMENT_READY },
  funnel: { completed, withEnRoute, withArrived, withBoth, durationInWindow: durationOk },
  captureRatePct: completed ? Number(((withBoth / completed) * 100).toFixed(1)) : 0,
  blockingReasons: blocking.map((b) => ({ reason: b.reason, n: Number(b.n) })),
  provenanceMix: provenance.map((p) => ({ source: p.source, n: Number(p.n) })),
  throughput: {
    completedPerMonth: Number(perMonth.toFixed(1)),
    labelYieldPct: Number((yieldRate * 100).toFixed(1)),
    eligibleLabelsPerMonth: Number(labelsPerMonth.toFixed(1)),
    monthsToGate: monthsToGate === null ? null : Number(monthsToGate.toFixed(1)),
    monthsToSegmentReady: monthsToSegment === null ? null : Number(monthsToSegment.toFixed(1)),
  },
  diagnosis,
  action,
};

if (AS_JSON) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const line = "=".repeat(74);
console.log(`\n${line}\n  ETA COLLECTION MONITOR — ${payload.generatedAt}\n${line}\n`);
console.log(`  TRAINING GATE   ${bar(eligible, THRESHOLD)}  ${eligible}/${THRESHOLD}`);
console.log(`  SEGMENT-READY   ${bar(eligible, SEGMENT_READY)}  ${eligible}/${SEGMENT_READY}\n`);

console.log("  CAPTURE FUNNEL (completed bookings)");
console.log(`    completed                  ${completed}`);
console.log(`    ...with enRouteAt          ${withEnRoute}`);
console.log(`    ...with arrivedAt          ${withArrived}`);
console.log(`    ...with both               ${withBoth}   (${payload.captureRatePct}% capture rate)`);
console.log(`    ...duration in [${ETA_TRAINING_CONTRACT.minTravelSec}, ${ETA_TRAINING_CONTRACT.maxTravelSec}]s   ${durationOk}`);
console.log(`    ...REAL eligible           ${eligible}\n`);

console.log("  WHY LABELS ARE BLOCKED");
for (const b of payload.blockingReasons) console.log(`    ${String(b.n).padStart(4)}  ${b.reason}`);

console.log("\n  ARRIVAL PROVENANCE  (explicit_partner_action = the lifecycle fix in use)");
for (const p of payload.provenanceMix) console.log(`    ${String(p.n).padStart(4)}  ${p.source}`);

console.log("\n  THROUGHPUT");
console.log(`    completed/month            ${payload.throughput.completedPerMonth}`);
console.log(`    label yield                ${payload.throughput.labelYieldPct}%`);
console.log(`    eligible labels/month      ${payload.throughput.eligibleLabelsPerMonth}`);
console.log(`    months to gate (50)        ${payload.throughput.monthsToGate ?? "n/a — zero yield"}`);
console.log(`    months to segment-ready    ${payload.throughput.monthsToSegmentReady ?? "n/a — zero yield"}`);

console.log(`\n  DIAGNOSIS  ${diagnosis}`);
console.log(`  ACTION     ${action}\n${line}\n`);
process.exit(0);
