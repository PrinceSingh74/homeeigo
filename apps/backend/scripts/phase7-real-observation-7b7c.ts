import "../src/load-env";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { PlatformIntelligenceService } from "../src/services/platform-intelligence.service";
import { invalidateFlagCache } from "../src/services/feature-flag.service";
import { userPiiService } from "../src/services/user-pii.service";

const jwt = new JWTService();
const platformIntel = new PlatformIntelligenceService();
const ADMIN_ID = "cmq9h67pk0000tz8s6tvnpet5";
const REAL_CUSTOMER_ID = "cmqbzopsk004jtzs8k3e08ihx";
const REAL_RATED_BOOKING_ID = "cmse8tbwi00dvtz3wckgbwdmn";

async function sideEffectSnapshot() {
  const [bookings, payments, wallets, ratings, notifications] = await Promise.all([
    prisma.booking.count(),
    prisma.payment.count(),
    prisma.user.aggregate({ _sum: { walletBalance: true } }),
    prisma.rating.count(),
    prisma.notification.count(),
  ]);
  return { bookings, payments, walletSum: wallets._sum.walletBalance, ratings, notifications };
}

async function main() {
  console.log("=== PHASE 7 STEP 7B/7C — REAL OBSERVATION ===");
  console.log("Time:", new Date().toISOString());

  const userRow = await prisma.user.findUnique({
    where: { id: REAL_CUSTOMER_ID },
    select: {
      id: true, email: true, isActive: true, isBanned: true, role: true,
      emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true,
    },
  });
  if (!userRow) throw new Error("Real customer not found");
  const resolvedEmail = await userPiiService.resolveEmail(userRow, { actorId: ADMIN_ID, authorized: true });
  if (!resolvedEmail) throw new Error("Could not resolve real customer's email (encrypted, real production PII path)");
  const user = { id: userRow.id, email: resolvedEmail, isActive: userRow.isActive, isBanned: userRow.isBanned, role: userRow.role };
  console.log("\nReal observation subject (pre-existing, not created this session):");
  console.log(" ", JSON.stringify({ ...user, email: `${resolvedEmail.slice(0, 3)}***` }));
  if (!user.isActive || user.isBanned) throw new Error("REFUSING: subject is not active/usable");

  const admin = await prisma.user.findUnique({ where: { id: ADMIN_ID }, select: { id: true, role: true, isActive: true } });
  if (!admin || admin.role !== "ADMIN" || !admin.isActive) throw new Error("REFUSING: admin does not resolve to an active ADMIN");
  console.log("Admin verified:", JSON.stringify(admin));

  const env = process.env.APP_ENV || process.env.NODE_ENV || "development";
  await platformIntel.upsertFlag(
    { key: "AI_REBOOKING", enabled: true, rolloutPct: 100, environment: env },
    { adminId: ADMIN_ID, userId: ADMIN_ID },
    "Phase 7 Step 7B real observation — temporary enable to observe genuine engine output for a real customer",
  );
  await platformIntel.upsertFlag(
    { key: "AI_SATISFACTION_INTELLIGENCE", enabled: true, rolloutPct: 100, environment: env },
    { adminId: ADMIN_ID, userId: ADMIN_ID },
    "Phase 7 Step 7C real observation — temporary enable to observe genuine engine output for a real customer",
  );

  const before = await sideEffectSnapshot();
  console.log("\nSide-effect snapshot BEFORE:", JSON.stringify(before));

  const token = jwt.generateAccessToken({ userId: user.id, email: user.email });

  console.log("\n--- REBOOKING (real HTTP call, real customer, real booking history) ---");
  const rebookingRes = await app.handle(
    new Request("http://localhost/api/customer-intel/rebooking?limit=3", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  const rebookingBody = await rebookingRes.json();
  console.log("status:", rebookingRes.status);
  console.log("body:", JSON.stringify(rebookingBody, null, 2));

  console.log("\n--- SATISFACTION (real HTTP call, real booking, real 5-star rating) ---");
  const satRes = await app.handle(
    new Request(`http://localhost/api/customer-intel/satisfaction/${REAL_RATED_BOOKING_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  const satBody = await satRes.json();
  console.log("status:", satRes.status);
  console.log("body:", JSON.stringify(satBody, null, 2));

  const after = await sideEffectSnapshot();
  console.log("\nSide-effect snapshot AFTER:", JSON.stringify(after));

  const unchanged =
    before.bookings === after.bookings &&
    before.payments === after.payments &&
    before.walletSum === after.walletSum &&
    before.ratings === after.ratings &&
    before.notifications === after.notifications;
  console.log("\nSide effects: ", unchanged ? "NONE (PASS)" : "UNEXPECTED MUTATION (FAIL)");

  // Turn the flags back off — this was a bounded observation, not a rollout decision.
  await prisma.platformFeatureFlag.deleteMany({ where: { key: { in: ["AI_REBOOKING", "AI_SATISFACTION_INTELLIGENCE"] } } });
  await invalidateFlagCache("AI_REBOOKING");
  await invalidateFlagCache("AI_SATISFACTION_INTELLIGENCE");
  console.log("\nFlags reset to absent (fail-closed OFF) after observation.");

  if (rebookingRes.status !== 200 || satRes.status !== 200 || !unchanged) {
    console.error("\nOBSERVATION FAILED — do not proceed to certification");
    process.exit(1);
  }

  console.log("\n=== REAL OBSERVATION COMPLETE, GATES SATISFIED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
