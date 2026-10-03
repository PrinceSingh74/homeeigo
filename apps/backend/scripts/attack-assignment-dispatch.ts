/**
 * Phase 4 — Assignment dispatch race attack (isolated homigo_test).
 *   A) Double dispatch via N concurrent processQueue()  → expect ONE SENT attempt.
 *   B) Worst-case via N concurrent dispatchToNextProvider() (bypasses the queue
 *      lock) → characterises whether the Redis/in-memory lock is the sole guard.
 *   C) Concurrent accept by the dispatched provider → exactly one ACCEPTED.
 *
 *   NODE_ENV=test bun run scripts/attack-assignment-dispatch.ts
 *
 * Each round seeds the shared adversarial fixture (its own service, and a partner that is ACTIVE,
 * inside its service radius, within working hours and holding a fresh presence heartbeat) and pays
 * the booking before the job is dispatched. The earlier hand-made partners failed the eligibility
 * gates added after this script was written, and dispatch is withheld for unpaid bookings (owner
 * decision #1, assignment-engine `isSettled`), so every round dispatched to nobody — SENT=0 — which
 * the old verdict mislabelled "DUPLICATE DISPATCH". A round with no dispatch is now reported as a
 * harness failure, never as a race result.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { assignmentEngine } from "../src/services/assignment-engine.service";
import {
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  futureSlot,
} from "../src/__tests__/helpers/adversarial-fixtures";

type Outcome = "pass" | "fail" | "setup";
const FANOUT = Number(process.env.ASSIGNMENT_BROADCAST_FANOUT || 25);
const runIds: string[] = [];
let round = 0;

/** A paid, provider-less booking for a freshly seeded fixture, and its assignment job. */
async function makeBookingJob(): Promise<{ bookingId: string; jobId: string } | null> {
  const runId = `add${Date.now().toString(36)}${round}`;
  runIds.push(runId);
  const ctx = await seedAdversarialFixtures(runId);
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    addressId: ctx.addressAId,
    scheduledDate: futureSlot(72 + (round++ % 20) * 3).toISOString(),
  });
  if (!("booking" in created)) {
    console.log(`  SETUP FAILED (harness): ${JSON.stringify(created)}`);
    return null;
  }
  await prisma.booking.update({ where: { id: created.booking.id }, data: { paymentStatus: "SUCCESS" } });
  const job = await assignmentEngine.createJob(created.booking.id);
  return { bookingId: created.booking.id, jobId: job.id };
}

async function dispatchAttack(N: number, direct: boolean): Promise<Outcome> {
  const made = await makeBookingJob();
  if (!made) return "setup";
  const { bookingId, jobId } = made;

  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) {
    ops.push(direct ? (assignmentEngine as unknown as { dispatchToNextProvider(j: string): Promise<boolean> }).dispatchToNextProvider(jobId) : assignmentEngine.processQueue());
  }
  const results = await Promise.allSettled(ops);
  const crashed = results.filter((r) => r.status === "rejected").length;

  const sentAttempts = await prisma.assignmentAttempt.count({ where: { jobId, status: "SENT" } });
  const allAttempts = await prisma.assignmentAttempt.count({ where: { jobId } });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { providerId: true, status: true } });
  const distinctProviders = await prisma.assignmentAttempt.findMany({ where: { jobId, status: "SENT" }, select: { providerId: true }, distinct: ["providerId"] });

  const label = `  [${direct ? "DIRECT (no lock)" : "processQueue (lock)"}] N=${String(N).padStart(3)}  SENT=${sentAttempts} (want 1)  totalAttempts=${allAttempts}  distinctProviders=${distinctProviders.length} (want 1)  booking.provider=${booking.providerId ? "1" : "0"}  crashed=${crashed}`;
  if (sentAttempts === 0 && crashed === 0) {
    console.log(`${label}  → ⚠ NO DISPATCH (harness: nobody was matched — no verdict on duplication)`);
    return "setup";
  }
  // Broadcast dispatch (the default, ASSIGNMENT_BROADCAST) offers one job to up to BROADCAST_FANOUT
  // partners at once — `assignment-dispatch-lock.test.ts` "broadcast compatibility" asserts that, and
  // the job_id-only SENT index was dropped for it. So the race invariant is NOT "one SENT": it is
  // "no partner offered the same job twice" (SENT == distinct partners) within the fan-out, and the
  // booking stays unassigned until a partner accepts (phase C).
  const pass = sentAttempts >= 1 && sentAttempts <= FANOUT && sentAttempts === distinctProviders.length && crashed === 0 && booking.providerId === null;
  console.log(`${label}  → ${pass ? "✅ no partner offered twice" : "❌ DUPLICATE DISPATCH"}`);
  return pass ? "pass" : "fail";
}

async function acceptAttack(N: number): Promise<Outcome> {
  const made = await makeBookingJob();
  if (!made) return "setup";
  const { bookingId, jobId } = made;
  await assignmentEngine.processQueue(); // broadcast the offer
  const offered = (await prisma.assignmentAttempt.findMany({ where: { jobId, status: "SENT" }, select: { providerId: true } })).map((a) => a.providerId);
  if (offered.length === 0) { console.log(`  [accept] N=${N} ⚠ NO DISPATCH (harness) — no verdict`); return "setup"; }

  // Every offered partner accepts at once, round-robin — the broadcast race: exactly one may win.
  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) ops.push(bookingService.accept(offered[i % offered.length], bookingId));
  const results = await Promise.allSettled(ops);
  const crashed = results.filter((r) => r.status === "rejected").length;
  const okCount = results.filter((r) => r.status === "fulfilled" && (r.value as { ok?: boolean })?.ok === true).length;

  const acceptedAttempts = await prisma.assignmentAttempt.count({ where: { jobId, status: "ACCEPTED" } });
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const winnerWasOffered = b.providerId !== null && offered.includes(b.providerId);

  const pass = b.status === "ACCEPTED" && winnerWasOffered && okCount === 1 && acceptedAttempts <= 1 && crashed === 0;
  console.log(
    `  [accept] N=${String(N).padStart(3)}  offered=${offered.length}  accept.ok=${okCount} (want 1)  acceptedAttempts=${acceptedAttempts} (want ≤1)  bookingStatus=${b.status}  winnerWasOffered=${winnerWasOffered}  crashed=${crashed}  → ${pass ? "✅ one provider wins" : "❌ FAIL"}`,
  );
  return pass ? "pass" : "fail";
}

async function main() {
  console.log("🔨 Assignment dispatch race attack (isolated homigo_test):");
  const guarded: Outcome[] = [];
  const direct: Outcome[] = [];
  try {
    console.log("\nA) Double dispatch via concurrent processQueue (lock-protected):");
    for (const N of [50, 100, 250, 500]) guarded.push(await dispatchAttack(N, false));

    console.log("\nB) Worst-case: direct dispatchToNextProvider (NO queue lock):");
    for (const N of [50, 250]) direct.push(await dispatchAttack(N, true));

    console.log("\nC) Concurrent accept (multiple attempts, one provider):");
    for (const N of [50, 100, 250, 500]) guarded.push(await acceptAttack(N));
  } finally {
    for (const id of runIds) await cleanupAdversarialFixtures(id);
  }

  const harness = [...guarded, ...direct].includes("setup");
  const defect = guarded.includes("fail");
  console.log(`\nProcessQueue dispatch + accept: ${defect ? "❌ DEFECT" : harness ? "⚠ INCOMPLETE (harness rounds without a verdict)" : "✅ SAFE"}`);
  console.log(`Direct (unlocked) dispatch duplicated: ${direct.includes("fail") ? "YES — lock is the sole guard (see report)" : direct.includes("setup") ? "no verdict (harness)" : "no"}`);
  await prisma.$disconnect();
  process.exit(defect ? 1 : harness ? 2 : 0);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
