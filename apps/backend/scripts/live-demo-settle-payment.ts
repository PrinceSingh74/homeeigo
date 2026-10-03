import "../src/load-env";
import { requireDeclaredTarget } from "./lib/script-target";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";
requireDeclaredTarget({ label: "live-demo-settle-payment" });

const jwt = new JWTService();
const CUSTOMER_ID = "cmqbzopsk004jtzs8k3e08ihx";
const BOOKING_ID = "cmt71surp0002tzi01fljfe8e";

async function main() {
  const userRow = await prisma.user.findUnique({
    where: { id: CUSTOMER_ID },
    select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true },
  });
  if (!userRow) throw new Error("customer not found");
  const email = await userPiiService.resolveEmail(userRow, { actorId: CUSTOMER_ID, authorized: true });
  if (!email) throw new Error("email not resolved");
  const token = jwt.generateAccessToken({ userId: CUSTOMER_ID, email });

  console.log("--- POST /api/payments/create-order ---");
  const orderRes = await app.handle(
    new Request("http://localhost/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: BOOKING_ID }),
    }),
  );
  const orderBody = await orderRes.json();
  console.log("status:", orderRes.status);
  console.log("body:", JSON.stringify(orderBody, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
