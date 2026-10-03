import "../src/load-env";
import prisma from "../src/lib/prisma";

const BOOKING_ID = "cmt72e41w008mtzc0vi9w4je1";

async function main() {
  console.log("=== DEEP CHECK: real booking reported by user ===\n");

  const booking = await prisma.booking.findUnique({
    where: { id: BOOKING_ID },
    include: {
      service: { select: { id: true, name: true, isActive: true, category: true } },
      address: { select: { latitude: true, longitude: true, city: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
      assignmentJob: {
        include: {
          attempts: { orderBy: { dispatchedAt: "asc" } },
          audits: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  if (!booking) {
    console.log("BOOKING NOT FOUND AT ALL — id may be wrong or booking creation itself failed silently.");
    process.exit(1);
  }

  console.log("Booking:");
  console.log("  id:", booking.id);
  console.log("  bookingNumber:", booking.bookingNumber);
  console.log("  status:", booking.status);
  console.log("  paymentStatus:", booking.paymentStatus);
  console.log("  providerId:", booking.providerId);
  console.log("  createdAt:", booking.createdAt.toISOString());
  console.log("  scheduledDate:", booking.scheduledDate.toISOString());
  console.log("  serviceId:", booking.serviceId, "->", booking.service.name, "(active:", booking.service.isActive, ", category:", booking.service.category, ")");
  console.log("  address:", JSON.stringify(booking.address));
  console.log("  customer:", booking.user.firstName, booking.user.lastName);

  console.log("\nAssignmentJob:");
  if (!booking.assignmentJob) {
    console.log("  NONE — no AssignmentJob row exists at all for this booking!");
  } else {
    const j = booking.assignmentJob;
    console.log("  id:", j.id);
    console.log("  status:", j.status);
    console.log("  dispatchAttempts:", j.dispatchAttempts, "/", j.maxAttempts);
    console.log("  currentProviderId:", j.currentProviderId);
    console.log("  lastDispatchedAt:", j.lastDispatchedAt?.toISOString() ?? null);
    console.log("  timeoutAt:", j.timeoutAt?.toISOString() ?? null);
    console.log("\n  Attempts:");
    for (const a of j.attempts) {
      console.log(`    -> provider=${a.providerId} status=${a.status} dispatchedAt=${a.dispatchedAt.toISOString()} respondedAt=${a.respondedAt?.toISOString() ?? "null"}`);
    }
    console.log("\n  Audit trail:");
    for (const a of j.audits) {
      console.log(`    ${a.createdAt.toISOString()} [${a.action}] ${a.details}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
