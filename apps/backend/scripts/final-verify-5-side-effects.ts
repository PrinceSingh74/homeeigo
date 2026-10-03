import "../src/load-env";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";

const jwt = new JWTService();
const CUSTOMER_ID = "cmqbzopsk004jtzs8k3e08ihx";

async function snapshot() {
  const [bookings, payments, walletSum, ratings, notifications, outbox, workflowInstances, refunds, payouts] = await Promise.all([
    prisma.booking.count(),
    prisma.payment.count(),
    prisma.user.aggregate({ _sum: { walletBalance: true } }),
    prisma.rating.count(),
    prisma.notification.count(),
    prisma.eventOutbox.count(),
    prisma.workflowInstance.count(),
    prisma.refundRequest.count(),
    prisma.withdrawal.count(),
  ]);
  return {
    bookings, payments, walletSum: walletSum._sum.walletBalance, ratings, notifications,
    outbox, workflowInstances, refunds, payouts,
  };
}

async function main() {
  console.log("=== STEP 5: SIDE-EFFECT VERIFICATION (rebooking + satisfaction + vision status) ===\n");

  const userRow = await prisma.user.findUnique({
    where: { id: CUSTOMER_ID },
    select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true },
  });
  const email = await userPiiService.resolveEmail(userRow!, { actorId: CUSTOMER_ID, authorized: true });
  const token = jwt.generateAccessToken({ userId: CUSTOMER_ID, email: email! });

  const before = await snapshot();
  console.log("BEFORE:", JSON.stringify(before));

  await app.handle(new Request("http://localhost/api/customer-intel/rebooking", { headers: { Authorization: `Bearer ${token}` } }));
  await app.handle(new Request("http://localhost/api/vision/status", { headers: { Authorization: `Bearer ${jwt.generateAccessToken({ userId: "cmq9h67pk0000tz8s6tvnpet5", email: "admin@homigo.demo" })}` } }));

  const after = await snapshot();
  console.log("AFTER: ", JSON.stringify(after));

  const keys = Object.keys(before) as (keyof typeof before)[];
  let unchanged = true;
  for (const k of keys) {
    if (before[k] !== after[k]) {
      console.log(`  MUTATION DETECTED: ${k} changed from ${before[k]} to ${after[k]}`);
      unchanged = false;
    }
  }
  console.log("\nAll side-effect counters unchanged:", unchanged);
  process.exit(unchanged ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
