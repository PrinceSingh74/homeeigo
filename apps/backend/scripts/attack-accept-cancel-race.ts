/**
 * Accept-vs-cancel race attack (isolated homigo_test). For each level N: create
 * ONE PENDING booking (with provider), then fire N/2 accepts + N/2 cancels
 * concurrently. Proves a SINGLE valid terminal state — no double-acceptance, no
 * split state (ACCEPTED with cancelledAt, or vice-versa), no crash.
 *
 *   NODE_ENV=test bun run scripts/attack-accept-cancel-race.ts
 *
 * The partner comes from the shared adversarial fixture (lifecycle ACTIVE, working hours, base
 * location, presence session): a bare provider row is refused by the direct-assign eligibility gate
 * (lifecycle APPLIED → ACCOUNT_RESTRICTED), so every round failed at setup and the attack never ran.
 * The booking is marked paid before the race, as in release-blocker-wave2: `accept()` refuses an
 * unpaid booking, which would make every accept lose and the race vacuous. Slots sit more than a day
 * ahead so the live-presence gate for near jobs cannot decide the outcome.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import {
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  futureSlot,
  type AdvCtx,
} from "../src/__tests__/helpers/adversarial-fixtures";

type Outcome = "pass" | "fail" | "setup";

async function race(N: number, ctx: AdvCtx, slotHours: number): Promise<{ outcome: Outcome; acceptWon: boolean }> {
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: futureSlot(slotHours).toISOString(),
  });
  if (!("booking" in created)) {
    console.log(`  N=${N} SETUP FAILED (harness, not a race result): ${JSON.stringify(created)}`);
    return { outcome: "setup", acceptWon: false };
  }
  const bookingId = created.booking.id;
  await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: "SUCCESS" } });

  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) {
    ops.push(i % 2 === 0 ? bookingService.accept(ctx.providerId, bookingId) : bookingService.cancel({ userId: ctx.customerA.id }, bookingId, "race"));
  }
  const results = await Promise.allSettled(ops);
  const crashed = results.filter((r) => r.status === "rejected").length;
  const acceptOk = results.filter((r, i) => i % 2 === 0 && r.status === "fulfilled" && (r.value as { ok?: boolean })?.ok === true).length;

  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  // Valid terminal states: a single accepted-active booking, or a cancelled one.
  // (CANCELLED_BY_USER with acceptedAt set is VALID — accepted then cancelled.)
  const cancelled = b.status === "CANCELLED_BY_USER" || b.status === "CANCELLED";
  const terminalOk = b.status === "ACCEPTED" || cancelled;
  // True corruption: an ACCEPTED booking that ALSO carries a cancellation, OR no
  // single provider, OR more than one accept reported success.
  const corrupt = (b.status === "ACCEPTED" && b.cancelledAt !== null) || (b.status === "ACCEPTED" && !b.providerId) || acceptOk > 1;

  const pass = terminalOk && !corrupt && crashed === 0;
  console.log(
    `  N=${String(N).padStart(3)}  finalStatus=${b.status}  acceptedAt=${b.acceptedAt ? "set" : "null"}  cancelledAt=${b.cancelledAt ? "set" : "null"}  acceptOk=${acceptOk} (max 1)  provider=${b.providerId ? "1" : "0"}  corrupt=${corrupt}  crashed=${crashed}  → ${pass ? "✅ single clean terminal" : "❌ FAIL"}`,
  );
  return { outcome: pass ? "pass" : "fail", acceptWon: b.acceptedAt !== null };
}

async function main() {
  console.log("🔨 Accept-vs-cancel race (isolated homigo_test):");
  const runId = `acr${Date.now().toString(36)}`;
  const ctx = await seedAdversarialFixtures(runId);
  const outcomes: Outcome[] = [];
  let acceptWins = 0;
  try {
    const levels = [50, 100, 250, 500];
    for (let i = 0; i < levels.length; i++) {
      const r = await race(levels[i], ctx, 72 + i * 6);
      outcomes.push(r.outcome);
      if (r.acceptWon) acceptWins++;
    }
  } finally {
    await cleanupAdversarialFixtures(runId);
  }
  console.log(`  accept reached the booking in ${acceptWins}/${outcomes.length} rounds (0 would mean the race only ever exercised cancel)`);
  let code = 0;
  if (outcomes.includes("setup")) {
    console.log("\n⚠ HARNESS: at least one round could not be set up — no verdict on the race for that round");
    code = 2;
  }
  if (outcomes.includes("fail")) {
    console.log("\n❌ split/double-state reproduced");
    code = 1;
  } else if (code === 0) {
    console.log("\n✅ VERIFIED: single valid terminal state under accept/cancel races (no double-accept, no split, no crash)");
  }
  await prisma.$disconnect();
  process.exit(code);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
