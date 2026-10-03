import "../src/load-env";
import { requireDeclaredTarget } from "./lib/script-target";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";
import { providerService } from "../src/services/provider.service";
requireDeclaredTarget({ label: "live-demo-accept-booking" });

const jwt = new JWTService();
const BOOKING_ID = "cmt71surp0002tzi01fljfe8e";
const PROVIDER_ID = "prov_phase2-cert-1786085847281";

async function main() {
  console.log("=== LIVE DEMO: Partner ACCEPTS the booking via the REAL partner API ===\n");

  const provider = await prisma.provider.findUnique({
    where: { id: PROVIDER_ID },
    select: { id: true, userId: true },
  });
  if (!provider) throw new Error("provider not found");

  const userRow = await prisma.user.findUnique({
    where: { id: provider.userId },
    select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true },
  });
  if (!userRow) throw new Error("provider user not found");
  const email = await userPiiService.resolveEmail(userRow, { actorId: userRow.id, authorized: true });
  if (!email) throw new Error("could not resolve provider email");

  const token = jwt.generateAccessToken({ userId: userRow.id, email });

  console.log(`POST /api/bookings/${BOOKING_ID}/accept  (as real provider ${PROVIDER_ID})`);
  const res = await app.handle(
    new Request(`http://localhost/api/bookings/${BOOKING_ID}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ eta: 20 }),
    }),
  );
  const body = await res.json();
  console.log("\nResponse status:", res.status);
  console.log("Response body:", JSON.stringify(body, null, 2));

  console.log("\n--- Re-checking real booking row after accept ---");
  const booking = await prisma.booking.findUnique({
    where: { id: BOOKING_ID },
    select: { id: true, bookingNumber: true, status: true, providerId: true, acceptedAt: true, eta: true },
  });
  console.log(JSON.stringify(booking, null, 2));

  console.log("\n--- Confirming it now shows in the provider's ACCEPTED/active jobs, not pending ---");
  const pending = await providerService.myBookings(PROVIDER_ID, { status: "pending" });
  const stillPending = pending.bookings.find((b: any) => b.id === BOOKING_ID);
  console.log("Still in pending list:", stillPending ? "YES (unexpected)" : "NO (correct — moved out of pending)");

  process.exit(res.status === 200 ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
