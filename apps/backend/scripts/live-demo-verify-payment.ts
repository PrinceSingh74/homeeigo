import "../src/load-env";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";

const jwt = new JWTService();
const CUSTOMER_ID = "cmqbzopsk004jtzs8k3e08ihx";
const RAZORPAY_ORDER_ID = "order_TTYw87JwKS6vdI";
const FAKE_PAYMENT_ID = "pay_e2edemo000000001";

async function main() {
  const userRow = await prisma.user.findUnique({
    where: { id: CUSTOMER_ID },
    select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true },
  });
  if (!userRow) throw new Error("customer not found");
  const email = await userPiiService.resolveEmail(userRow, { actorId: CUSTOMER_ID, authorized: true });
  if (!email) throw new Error("email not resolved");
  const token = jwt.generateAccessToken({ userId: CUSTOMER_ID, email });

  console.log("--- POST /api/payments/e2e/mock-signature ---");
  const sigRes = await app.handle(
    new Request("http://localhost/api/payments/e2e/mock-signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razorpayOrderId: RAZORPAY_ORDER_ID, razorpayPaymentId: FAKE_PAYMENT_ID }),
    }),
  );
  const sigBody = await sigRes.json();
  console.log("status:", sigRes.status, "body:", JSON.stringify(sigBody));
  if (!sigBody.success) throw new Error("mock signature failed");

  console.log("\n--- POST /api/payments/verify ---");
  const verifyRes = await app.handle(
    new Request("http://localhost/api/payments/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        razorpayOrderId: RAZORPAY_ORDER_ID,
        razorpayPaymentId: FAKE_PAYMENT_ID,
        razorpaySignature: sigBody.data.razorpaySignature,
      }),
    }),
  );
  const verifyBody = await verifyRes.json();
  console.log("status:", verifyRes.status);
  console.log("body:", JSON.stringify(verifyBody, null, 2));

  process.exit(verifyRes.status === 200 ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
