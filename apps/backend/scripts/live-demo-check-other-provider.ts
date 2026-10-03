import "../src/load-env";
import { providerService } from "../src/services/provider.service";
import prisma from "../src/lib/prisma";

const OTHER_PROVIDER_ID = "prov_phase2-cert-1786084840318";
const BOOKING_ID = "cmt71surp0002tzi01fljfe8e";

async function main() {
  const pending = await providerService.myBookings(OTHER_PROVIDER_ID, { status: "pending" });
  const stillThere = pending.bookings.find((b: any) => b.id === BOOKING_ID);
  console.log("Other offered provider still sees it as pending:", stillThere ? "YES (should be cleared)" : "NO (correctly cleared)");

  const attempt = await prisma.assignmentAttempt.findFirst({
    where: { providerId: OTHER_PROVIDER_ID, job: { bookingId: BOOKING_ID } },
    select: { status: true, respondedAt: true },
  });
  console.log("Their AssignmentAttempt status:", JSON.stringify(attempt));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
