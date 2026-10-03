import "../src/load-env";
import { providerService } from "../src/services/provider.service";

const PROVIDER_ID = "cmrfxj1fm02aitz78sm9depfw";
const BOOKING_ID = "cmt72e41w008mtzc0vi9w4je1";

async function main() {
  const result = await providerService.myBookings(PROVIDER_ID, { status: "pending" });
  const found = result.bookings.find((b: any) => b.id === BOOKING_ID);
  if (found) {
    console.log("✅ FOUND — the real provider genuinely sees this booking right now:");
    console.log(JSON.stringify(found, null, 2));
  } else {
    console.log("❌ NOT FOUND. Total pending for this provider:", result.total);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
