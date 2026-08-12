/**
 * E2E: customer booking → DB → assignment engine → partner dispatch → accept.
 * Real execution against isolated homigo_test (NODE_ENV=test). Captures the DB
 * row / job / attempt at every phase as evidence.
 *
 *   NODE_ENV=test bun run scripts/e2e-booking-assignment.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { assignmentEngine } from "../src/services/assignment-engine.service";

const ts = Date.now();
const line = (s: string) => console.log(s);

async function main() {
  // ── setup: service, customer+address, eligible provider ──
  const service = await prisma.service.create({
    data: { name: `E2E Clean ${ts}`, slug: `e2e-${ts}`, description: "x", category: "cleaning", basePrice: 800, estimatedDuration: 60, isActive: true },
  });
  const customer = await prisma.user.create({
    data: { email: `e2e-cust-${ts}@homigo.test`, phoneNumber: `+9195${ts % 10000000}`, firstName: "Cust", lastName: "E2E", password: "x".repeat(20) },
  });
  const address = await prisma.address.create({
    data: { userId: customer.id, label: "Home", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.07, longitude: 72.87 },
  });
  const provUser = await prisma.user.create({
    data: { email: `e2e-prov-${ts}@homigo.test`, phoneNumber: `+9194${ts % 10000000}`, firstName: "Prov", lastName: "E2E", password: "x".repeat(20), role: "VENDOR" },
  });
  const provider = await prisma.provider.create({
    data: { userId: provUser.id, isActive: true, isApproved: true, isOnline: true, serviceCategories: [service.id] },
  });
  // Provider current location ~50m from the booking address (so the distance filter passes).
  await prisma.location.create({ data: { providerId: provider.id, latitude: 19.0705, longitude: 72.8705 } });
  line(`SETUP: service=${service.id.slice(0, 10)} customer=${customer.id.slice(0, 10)} provider=${provider.id.slice(0, 10)} (located in Mumbai)`);

  // ── PHASE 1+2: create booking (no providerId) → DB row + queue fields ──
  const created = await bookingService.create(customer.id, {
    serviceId: service.id,
    scheduledDate: new Date(Date.now() + 2 * 86400_000).toISOString(),
    addressId: address.id,
  });
  if ("error" in created) throw new Error("booking create failed: " + created.error);
  const bookingId = created.booking.id;
  const b1 = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  line(`\nPHASE 1/2 — booking created:`);
  line(`  id=${bookingId}  status=${b1.status}  provider_id=${b1.providerId ?? "NULL"}  queued_at=${b1.queuedAt ? "set" : "NULL"}  priority_score=${b1.priorityScore}  final=₹${b1.finalAmount}`);

  // ── PHASE 4a: assignment job created on booking? ──
  const job = await prisma.assignmentJob.findFirst({ where: { bookingId } });
  line(`\nPHASE 4a — assignment job: ${job ? `id=${job.id.slice(0, 10)} status=${job.status} attempts=${job.dispatchAttempts}/${job.maxAttempts}` : "❌ NONE"}`);

  // ── PHASE 4b: process the queue → dispatch to a provider ──
  const result = await assignmentEngine.processQueue();
  line(`\nPHASE 4b — processQueue(): processed=${result.processed} dispatched=${result.dispatched}`);
  const attempt = await prisma.assignmentAttempt.findFirst({ where: { job: { bookingId } }, orderBy: { dispatchedAt: "desc" } });
  line(`  dispatch attempt: ${attempt ? `provider=${attempt.providerId.slice(0, 10)} dispatchedAt=${attempt.dispatchedAt.toISOString().slice(11, 19)} (== our provider: ${attempt.providerId === provider.id})` : "❌ NONE (no eligible provider matched)"}`);

  // ── PHASE 5: partner sees the request (provider's pending dispatch) ──
  const partnerSees = await prisma.assignmentAttempt.count({ where: { providerId: provider.id, job: { bookingId } } });
  line(`\nPHASE 5 — partner received request: ${partnerSees > 0 ? `✅ ${partnerSees} dispatch to provider` : "❌ not dispatched"}`);

  // ── PHASE 6: provider accepts ──
  const acc = await bookingService.accept(provider.id, bookingId, 30);
  const b2 = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  line(`\nPHASE 6 — provider accept (${"error" in acc ? "error:" + acc.error : "ok"}):`);
  line(`  id=${bookingId}  status=${b2.status}  provider_id=${b2.providerId === provider.id ? "OUR PROVIDER ✅" : b2.providerId ?? "NULL"}  accepted_at=${b2.acceptedAt ? "set ✅" : "NULL"}  assigned_at=${b2.assignedAt ? "set" : "NULL"}`);

  // ── PHASE 7: end-to-end consistency (same id everywhere) ──
  const adminView = await prisma.booking.findFirst({ where: { id: bookingId }, include: { user: true, service: true, provider: true } });
  const partnerJobs = await prisma.booking.findMany({ where: { providerId: provider.id }, select: { id: true } });
  const consistent =
    adminView?.id === bookingId &&
    adminView?.user.id === customer.id &&
    adminView?.provider?.id === provider.id &&
    partnerJobs.some((j) => j.id === bookingId);
  line(`\nPHASE 7 — consistency: backend/DB/admin-view/partner-list all show ${bookingId.slice(0, 10)} → ${consistent ? "✅ CONSISTENT" : "❌ MISMATCH"}`);

  // ── verdict ──
  const pass =
    b1.status === "PENDING" && !!job && result.dispatched >= 1 && attempt?.providerId === provider.id &&
    !("error" in acc) && b2.providerId === provider.id && b2.status !== "PENDING" && !!b2.acceptedAt && consistent;
  line(`\n${pass ? "✅ WORKING" : "🟡 PARTIAL/BROKEN"} — booking → assignment → partner → accept verified end-to-end`);

  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
