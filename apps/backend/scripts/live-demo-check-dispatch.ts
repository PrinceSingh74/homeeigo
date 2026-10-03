import "../src/load-env";
import prisma from "../src/lib/prisma";
import { providerService } from "../src/services/provider.service";

const BOOKING_ID = "cmt71surp0002tzi01fljfe8e";
const PROVIDERS = [
  { id: "cmq9h687s0005tz8swhtkju1p", label: "Provider A" },
  { id: "cmsitqxy40002tzbczjyo2ex8", label: "Provider B" },
];

async function main() {
  console.log("=== CHECKING DISPATCH STATE FOR THE BOOKING JUST CREATED ===\n");

  const job = await prisma.assignmentJob.findUnique({
    where: { bookingId: BOOKING_ID },
    include: { attempts: true },
  });
  console.log("AssignmentJob:", JSON.stringify(job, null, 2));

  for (const p of PROVIDERS) {
    console.log(`\n--- ${p.label} (${p.id}) — calling real myBookings(status=pending) ---`);
    const result = await providerService.myBookings(p.id, { status: "pending" });
    const found = result.bookings.find((b: any) => b.id === BOOKING_ID);
    console.log(found ? "FOUND in pending offers:" : "NOT found in pending offers.");
    if (found) console.log(JSON.stringify(found, null, 2));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
