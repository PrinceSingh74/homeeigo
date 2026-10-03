import "../src/load-env";
import { requireDeclaredTarget } from "./lib/script-target";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";
requireDeclaredTarget({ label: "live-demo-create-booking" });

const jwt = new JWTService();
const CUSTOMER_ID = "cmqbzopsk004jtzs8k3e08ihx";
const ADDRESS_ID = "cmqbzrmru009etzs80nx8h1hu";
const SERVICE_ID = "cmq67k4br0007tznkspayufug"; // Bathroom Cleaning

async function main() {
  console.log("=== LIVE DEMO: Creating a REAL booking via the REAL customer API ===");
  console.log("Time:", new Date().toISOString());

  const userRow = await prisma.user.findUnique({
    where: { id: CUSTOMER_ID },
    select: {
      id: true, email: true, isActive: true, isBanned: true, isEmailVerified: true,
      emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true,
    },
  });
  if (!userRow) throw new Error("customer not found");
  const email = await userPiiService.resolveEmail(userRow, { actorId: CUSTOMER_ID, authorized: true });
  if (!email) throw new Error("could not resolve email");

  const token = jwt.generateAccessToken({ userId: CUSTOMER_ID, email });

  const scheduledDate = new Date(Date.now() + 8 * 24 * 3600_000).toISOString(); // 8 days out, avoids overlap

  console.log("\nPOST /api/bookings/  (exact same call the customer app makes)");
  console.log("  serviceId:", SERVICE_ID, "(Bathroom Cleaning)");
  console.log("  addressId:", ADDRESS_ID);
  console.log("  scheduledDate:", scheduledDate);

  const res = await app.handle(
    new Request("http://localhost/api/bookings/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serviceId: SERVICE_ID,
        addressId: ADDRESS_ID,
        scheduledDate,
        paymentMethod: "wallet",
      }),
    }),
  );

  const body = await res.json();
  console.log("\nResponse status:", res.status);
  console.log("Response body:", JSON.stringify(body, null, 2));

  if (res.status !== 201) {
    console.error("\nBOOKING CREATION FAILED");
    process.exit(1);
  }

  console.log("\n=== BOOKING CREATED ===");
  console.log("bookingId:", body.data.booking.id);
  console.log("bookingNumber:", body.data.booking.bookingNumber);
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
