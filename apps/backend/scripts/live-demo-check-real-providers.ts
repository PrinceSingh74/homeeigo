import "../src/load-env";
import prisma from "../src/lib/prisma";
import { providerService } from "../src/services/provider.service";

const BOOKING_ID = "cmt71surp0002tzi01fljfe8e";
const OFFERED_PROVIDER_IDS = ["prov_phase2-cert-1786085847281", "prov_phase2-cert-1786084840318"];

async function main() {
  const providers = await prisma.provider.findMany({
    where: { id: { in: OFFERED_PROVIDER_IDS } },
    select: { id: true, userId: true, isOnline: true, user: { select: { firstName: true, lastName: true } } },
  });
  console.log("Real providers who were actually offered this booking:");
  console.log(JSON.stringify(providers, null, 2));

  for (const p of providers) {
    console.log(`\n--- Calling real myBookings(status=pending) for ${p.user.firstName} ${p.user.lastName} (${p.id}) ---`);
    const result = await providerService.myBookings(p.id, { status: "pending" });
    const found = result.bookings.find((b: any) => b.id === BOOKING_ID);
    if (found) {
      console.log("✅ FOUND — this booking IS in their pending offers list right now:");
      console.log(JSON.stringify(found, null, 2));
    } else {
      console.log("❌ NOT found. Total pending offers they have:", result.total);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
