import "../src/load-env";
import prisma from "../src/lib/prisma";
import { providerService } from "../src/services/provider.service";

const BOOKING_ID = "cmt72e41w008mtzc0vi9w4je1";

async function main() {
  // The seeded demo partner account (ensure-demo-users.ts) — the one a real human would log into.
  const demoUser = await prisma.user.findFirst({
    where: { email: "partner@homigo.demo" },
    select: { id: true, email: true, role: true, provider: { select: { id: true, isOnline: true, isApproved: true, isActive: true, serviceCategories: true } } },
  });
  console.log("Demo partner account (partner@homigo.demo):");
  console.log(JSON.stringify(demoUser, null, 2));

  if (demoUser?.provider) {
    console.log("\nWas this specific booking offered to the demo partner?");
    const attempt = await prisma.assignmentAttempt.findFirst({
      where: { providerId: demoUser.provider.id, job: { bookingId: BOOKING_ID } },
    });
    console.log("AssignmentAttempt:", attempt ? JSON.stringify(attempt) : "NONE — never offered to this provider");

    console.log("\nCalling their real myBookings(status=pending):");
    const result = await providerService.myBookings(demoUser.provider.id, { status: "pending" });
    const found = result.bookings.find((b: any) => b.id === BOOKING_ID);
    console.log(found ? "FOUND in their pending list" : `NOT found. Their total pending: ${result.total}`);
  }

  // Also list ALL real (non phase2-cert) online providers matching Fridge Cleaning, for context.
  const SERVICE_ID = "cmr68qqbg0001tzb8vmeifvz6";
  const allMatching = await prisma.provider.findMany({
    where: { isActive: true, isApproved: true, serviceCategories: { has: SERVICE_ID } },
    select: { id: true, isOnline: true, currentStatus: true, user: { select: { email: true, firstName: true } } },
  });
  console.log("\nAll real providers matching Fridge Cleaning category (any account):");
  console.log(JSON.stringify(allMatching, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
