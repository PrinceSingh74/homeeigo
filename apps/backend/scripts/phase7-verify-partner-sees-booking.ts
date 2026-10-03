import "../src/load-env";
import { providerService } from "../src/services/provider.service";

async function main() {
  const PROVIDER_ID = "cmsitqxy40002tzbczjyo2ex8";

  console.log("Calling the exact same function GET /me/bookings?status=pending calls (providers.ts:143)...");
  const result = await providerService.myBookings(PROVIDER_ID, { status: "pending" });
  console.log(JSON.stringify(result, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
