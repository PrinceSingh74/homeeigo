import "../src/load-env";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";

const jwt = new JWTService();
const BOOKING_ID = "cmt720w6a0002tz6c5bufo43h";
const PROVIDER_ID = "prov_phase2-cert-1786084840318"; // the currentProviderId (first in broadcast)

async function main() {
  console.log("=== DEEP VERIFY 1: Real HTTP route GET /api/providers/me/bookings?status=pending ===\n");

  const provider = await prisma.provider.findUnique({ where: { id: PROVIDER_ID }, select: { userId: true } });
  if (!provider) throw new Error("provider not found");

  const userRow = await prisma.user.findUnique({
    where: { id: provider.userId },
    select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true },
  });
  if (!userRow) throw new Error("provider user not found");
  const email = await userPiiService.resolveEmail(userRow, { actorId: userRow.id, authorized: true });
  if (!email) throw new Error("could not resolve email");

  const token = jwt.generateAccessToken({ userId: userRow.id, email });

  console.log("GET /api/providers/me/bookings?status=pending  (real HTTP route, real provider JWT, NOT calling the service function directly)");
  const res = await app.handle(
    new Request("http://localhost/api/providers/me/bookings?status=pending", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  const body = await res.json();
  console.log("\nHTTP status:", res.status);

  const found = body?.data?.bookings?.find((b: any) => b.id === BOOKING_ID);
  if (found) {
    console.log("\n✅ FOUND via the REAL HTTP route — the exact response the partner's app receives:");
    console.log(JSON.stringify(found, null, 2));
  } else {
    console.log("\n❌ NOT FOUND. Full response:");
    console.log(JSON.stringify(body, null, 2));
  }

  process.exit(found ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
