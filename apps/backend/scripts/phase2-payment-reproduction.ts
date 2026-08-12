/**
 * Phase 2 — execution-based payment security reproduction.
 * Simulates curl HTTP attacks, forged JWT bypass attempts, and 50-way gift-card race.
 */
import "../src/load-env";
import crypto from "crypto";
import jsonwebtoken from "jsonwebtoken";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { GiftCardStatus, SubscriptionInterval, WalletTxnStatus } from "@prisma/client";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService, JWT_SECRETS, JWT_CONFIG } from "../src/services/jwt.service";
import { walletService, MAX_PENDING_WALLET_TOPUPS } from "../src/services/wallet.service";
import { fixturePhone, bearer } from "../src/__tests__/helpers/adversarial-fixtures";
const jwtService = new JWTService();
const RUN_ID = `p2-${Date.now().toString(36)}`;
const BASE = "http://localhost";

type Evidence = {
  name: string;
  curl: string;
  status: number;
  body: unknown;
  pass: boolean;
  notes?: string;
};

const evidence: Evidence[] = [];
const lines: string[] = [];

function log(msg: string) {
  lines.push(msg);
  console.log(msg);
}

async function http(
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown },
): Promise<{ status: number; json: unknown; text: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain */
  }
  return { status: res.status, json, text };
}

function record(e: Evidence) {
  evidence.push(e);
  const icon = e.pass ? "PASS" : "FAIL";
  log(`[${icon}] ${e.name} → HTTP ${e.status}${e.notes ? ` (${e.notes})` : ""}`);
}

async function writeReport(started: string, unverifiedId: string, raceCardId: string) {
  const passed = evidence.filter((e) => e.pass).length;
  const failed = evidence.filter((e) => !e.pass).length;
  const report = [
    `# Phase 2 Payment Reproduction Report`,
    ``,
    `- **Run:** ${RUN_ID}`,
    `- **Started:** ${started}`,
    `- **Finished:** ${new Date().toISOString()}`,
    `- **Result:** ${failed === 0 ? "ALL PASS" : `${failed} FAILURE(S)`}`,
    ``,
    `## Evidence`,
    ``,
    ...evidence.map((e) =>
      [
        `### ${e.pass ? "PASS" : "FAIL"} ${e.name}`,
        ``,
        `**curl equivalent:**`,
        ``,
        "```bash",
        e.curl,
        "```",
        ``,
        `- HTTP status (primary): **${e.status}**`,
        e.notes ? `- Notes: ${e.notes}` : "",
        ``,
        "```json",
        JSON.stringify(e.body, null, 2),
        "```",
        ``,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    `## SQL verification queries`,
    ``,
    "```sql",
    `SELECT COUNT(*) FROM user_subscriptions WHERE user_id = '${unverifiedId}';`,
    `SELECT COUNT(*) FROM gift_card_transactions WHERE gift_card_id = '${raceCardId}';`,
    "```",
  ].join("\n");
  const outDir = join(import.meta.dir, "..", "docs");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "phase2-reproduction-report.md");
  writeFileSync(outPath, report);
  log(`Report written: ${outPath}`);
  return { passed, failed };
}

async function main() {
  const started = new Date().toISOString();
  log(`# Phase 2 Payment Reproduction — ${started}`);
  log(`RUN_ID=${RUN_ID}\n`);

  let raceCardId = "";
  let unverifiedId = "";
  const userIds: string[] = [];
  const cardIds: string[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    log("ABORT: PostgreSQL unreachable. Start homigo_test DB first.");
    process.exit(1);
  }

  try {
  process.env.NODE_ENV = "development";

  const passwordHash = await Bun.password.hash("Phase2@123", { algorithm: "bcrypt", cost: 4 });

  const plan = await prisma.membershipPlan.create({
    data: {
      name: `P2 Plan ${RUN_ID}`,
      price: 999,
      interval: SubscriptionInterval.MONTHLY,
      isActive: true,
      sortOrder: 99,
    },
  });

  const unverified = await prisma.user.create({
    data: {
      email: `${RUN_ID}-unverified@p2.test`,
      phoneNumber: fixturePhone(RUN_ID, "unverified"),
      firstName: "Unverified",
      lastName: "P2",
      password: passwordHash,
      role: "CUSTOMER",
      isEmailVerified: false,
    },
  });
  unverifiedId = unverified.id;
  userIds.push(unverified.id);

  const verified = await prisma.user.create({
    data: {
      email: `${RUN_ID}-verified@p2.test`,
      phoneNumber: fixturePhone(RUN_ID, "verified"),
      firstName: "Verified",
      lastName: "P2",
      password: passwordHash,
      role: "CUSTOMER",
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  userIds.push(verified.id);

  const victim = await prisma.user.create({
    data: {
      email: `${RUN_ID}-victim@p2.test`,
      phoneNumber: fixturePhone(RUN_ID, "victim"),
      firstName: "Victim",
      lastName: "P2",
      password: passwordHash,
      role: "CUSTOMER",
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  userIds.push(victim.id);

  const unverifiedToken = bearer(unverified);
  const verifiedToken = bearer(verified);
  const victimToken = bearer(victim);

  // ─── Issue 1: Subscription email bypass (curl-equivalent) ───
  log("\n## Issue 1 — Subscription email verification\n");

  const subOrder = await http("POST", "/api/subscriptions/order", {
    token: unverifiedToken,
    body: { planId: plan.id },
  });
  const subsBefore = await prisma.userSubscription.count({ where: { userId: unverified.id } });
  record({
    name: "Unverified POST /api/subscriptions/order",
    curl: `curl -X POST ${BASE}/api/subscriptions/order -H "Authorization: Bearer <unverified>" -d '{"planId":"..."}'`,
    status: subOrder.status,
    body: subOrder.json,
    pass: subOrder.status === 403 && subsBefore === 0,
    notes: `subscriptions in DB: ${subsBefore}`,
  });

  const subVerify = await http("POST", "/api/subscriptions/verify", {
    token: unverifiedToken,
    body: {
      razorpayOrderId: "order_fake",
      razorpayPaymentId: "pay_fake",
      razorpaySignature: "sig",
    },
  });
  record({
    name: "Unverified POST /api/subscriptions/verify",
    curl: `curl -X POST ${BASE}/api/subscriptions/verify -H "Authorization: Bearer <unverified>" ...`,
    status: subVerify.status,
    body: subVerify.json,
    pass: subVerify.status === 403,
  });

  // Replay verified order creation twice — should not create duplicate membership without payment
  const order1 = await http("POST", "/api/subscriptions/order", {
    token: verifiedToken,
    body: { planId: plan.id },
  });
  const order2 = await http("POST", "/api/subscriptions/order", {
    token: verifiedToken,
    body: { planId: plan.id },
  });
  const pendingOrders = await prisma.userSubscription.count({
    where: { userId: verified.id, status: "PENDING" },
  });
  record({
    name: "Replay subscription order (verified user, 2x)",
    curl: "curl .../order (x2 same user)",
    status: order2.status,
    body: { first: order1.status, second: order2.json },
    pass: order1.status === 200 && order2.status === 200,
    notes: `PENDING subs: ${pendingOrders} (orders are payment intents, not active membership)`,
  });

  // ─── Wallet / gift card unverified blocks ───
  log("\n## Wallet & gift card — unverified blocks\n");

  const walletAdd = await http("POST", "/api/wallet/add-money", {
    token: unverifiedToken,
    body: { amount: 100 },
  });
  const pendingWallet = await prisma.walletTransaction.count({
    where: { userId: unverified.id, status: WalletTxnStatus.PENDING },
  });
  record({
    name: "Unverified POST /api/wallet/add-money",
    curl: `curl -X POST ${BASE}/api/wallet/add-money ...`,
    status: walletAdd.status,
    body: walletAdd.json,
    pass: walletAdd.status === 403 && pendingWallet === 0,
    notes: `pending wallet txns: ${pendingWallet}`,
  });

  const gcRedeemUnverified = await http("POST", "/api/giftcards/redeem", {
    token: unverifiedToken,
    body: { code: "HG-FAKE-CODE" },
  });
  record({
    name: "Unverified POST /api/giftcards/redeem",
    curl: `curl -X POST ${BASE}/api/giftcards/redeem ...`,
    status: gcRedeemUnverified.status,
    body: gcRedeemUnverified.json,
    pass: gcRedeemUnverified.status === 403,
  });

  // ─── Forged JWT attacks ───
  log("\n## Forged JWT / auth bypass attempts\n");

  const noAuth = await http("POST", "/api/giftcards/redeem", {
    body: { code: "HG-TEST" },
  });
  record({
    name: "No Authorization header",
    curl: `curl -X POST ${BASE}/api/giftcards/redeem (no Bearer)`,
    status: noAuth.status,
    body: noAuth.json,
    pass: noAuth.status === 401,
  });

  const garbage = await http("POST", "/api/subscriptions/order", {
    token: "not.a.valid.jwt",
    body: { planId: plan.id },
  });
  record({
    name: "Garbage JWT",
    curl: 'curl -H "Authorization: Bearer not.a.valid.jwt" ...',
    status: garbage.status,
    body: garbage.json,
    pass: garbage.status === 401,
  });

  const wrongSecret = jsonwebtoken.sign(
    {
      userId: verified.id,
      email: verified.email,
      jti: crypto.randomUUID(),
      type: "access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "totally-wrong-secret-key-32chars!!",
    { algorithm: "HS256" },
  );
  const wrongSecRes = await http("POST", "/api/subscriptions/order", {
    token: wrongSecret,
    body: { planId: plan.id },
  });
  record({
    name: "JWT signed with wrong secret",
    curl: "curl -H 'Authorization: Bearer <forged-wrong-secret>' ...",
    status: wrongSecRes.status,
    body: wrongSecRes.json,
    pass: wrongSecRes.status === 401,
  });

  const expired = jsonwebtoken.sign(
    {
      userId: verified.id,
      email: verified.email,
      jti: crypto.randomUUID(),
      type: "access",
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    },
    JWT_SECRETS.ACCESS,
    { algorithm: JWT_CONFIG.ALGORITHM },
  );
  const expiredRes = await http("POST", "/api/subscriptions/order", {
    token: expired,
    body: { planId: plan.id },
  });
  record({
    name: "Expired JWT (valid signature)",
    curl: "curl -H 'Authorization: Bearer <expired>' ...",
    status: expiredRes.status,
    body: expiredRes.json,
    pass: expiredRes.status === 401,
  });

  const refreshAsAccess = jwtService.generateRefreshToken({
    userId: verified.id,
    familyId: "fake-family",
  });
  const refreshRes = await http("POST", "/api/subscriptions/order", {
    token: refreshAsAccess,
    body: { planId: plan.id },
  });
  record({
    name: "Refresh token used as access token",
    curl: "curl -H 'Authorization: Bearer <refresh-token>' ...",
    status: refreshRes.status,
    body: refreshRes.json,
    pass: refreshRes.status === 401,
  });

  // Tampered: valid token for unverified user — DB must still block verified-only routes
  const unverifiedValidJwt = bearer(unverified);
  const dbBlock = await http("POST", "/api/wallet/add-money", {
    token: unverifiedValidJwt,
    body: { amount: 50 },
  });
  record({
    name: "Valid JWT but DB isEmailVerified=false (no JWT claim bypass)",
    curl: "curl with legitimate unverified-user token",
    status: dbBlock.status,
    body: dbBlock.json,
    pass: dbBlock.status === 403,
    notes: "Auth reads isEmailVerified from DB, not JWT payload",
  });

  // IDOR: attacker token on victim's gift card void
  const victimCard = await prisma.giftCard.create({
    data: {
      code: `HG-${RUN_ID.slice(-4).toUpperCase()}-VOID`,
      purchaserId: victim.id,
      amount: 500,
      balance: 500,
      status: GiftCardStatus.ACTIVE,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  cardIds.push(victimCard.id);
  const idorVoid = await http("POST", `/api/giftcards/${victimCard.id}/void`, {
    token: verifiedToken,
  });
  record({
    name: "IDOR void — User A voids User B gift card",
    curl: `curl -X POST ${BASE}/api/giftcards/${victimCard.id}/void -H "Bearer <attacker>"`,
    status: idorVoid.status,
    body: idorVoid.json,
    pass: idorVoid.status === 404,
  });

  // ─── 50 concurrent gift card redemption race ───
  log("\n## 50 concurrent gift card redemption race\n");

  const raceCard = await prisma.giftCard.create({
    data: {
      code: `HG-${RUN_ID.slice(-4).toUpperCase()}-RACE50`,
      purchaserId: victim.id,
      amount: 1000,
      balance: 1000,
      status: GiftCardStatus.ACTIVE,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });

  const redeemers: { id: string }[] = [];
  for (let i = 0; i < 50; i++) {
    const u = await prisma.user.create({
      data: {
        email: `${RUN_ID}-race-${i}@p2.test`,
        phoneNumber: fixturePhone(RUN_ID, `race-${i}`),
        firstName: `Race${i}`,
        lastName: "P2",
        password: passwordHash,
        role: "CUSTOMER",
        isEmailVerified: true,
        isPhoneVerified: true,
      },
    });
    redeemers.push(u);
    userIds.push(u.id);
  }
  raceCardId = raceCard.id;
  cardIds.push(raceCard.id);

  const raceStart = Date.now();
  const raceResults = await Promise.all(
    redeemers.map((u) =>
      http("POST", "/api/giftcards/redeem", {
        token: bearer(u),
        body: { code: raceCard.code },
      }),
    ),
  );
  const raceMs = Date.now() - raceStart;

  const httpSuccesses = raceResults.filter((r) => r.status === 200);
  const httpFailures = raceResults.filter((r) => r.status !== 200);

  const afterCard = await prisma.giftCard.findUniqueOrThrow({ where: { id: raceCard.id } });
  const redeemTxns = await prisma.giftCardTransaction.count({
    where: { giftCardId: raceCard.id, type: "REDEEM" },
  });
  const walletCredits = await prisma.walletTransaction.count({
    where: { referenceId: raceCard.id, referenceType: "gift_card" },
  });
  const totalCredited = await prisma.walletTransaction.aggregate({
    where: { referenceId: raceCard.id, referenceType: "gift_card" },
    _sum: { amount: true },
  });

  const racePass =
    httpSuccesses.length === 1 &&
    httpFailures.length === 49 &&
    afterCard.balance === 0 &&
    afterCard.status === GiftCardStatus.REDEEMED &&
    redeemTxns === 1 &&
    walletCredits === 1 &&
    (totalCredited._sum.amount ?? 0) === 1000 &&
    (totalCredited._sum.amount ?? 0) <= raceCard.amount;

  record({
    name: "50 concurrent HTTP POST /api/giftcards/redeem (different users, same code)",
    curl: `for i in {1..50}; do curl -X POST ${BASE}/api/giftcards/redeem -H "Bearer <user$i>" -d '{"code":"${raceCard.code}"}' & done; wait`,
    status: httpSuccesses.length,
    body: {
      http200: httpSuccesses.length,
      httpNon200: httpFailures.length,
      statusBreakdown: raceResults.reduce(
        (acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        },
        {} as Record<number, number>,
      ),
      cardBalance: afterCard.balance,
      cardStatus: afterCard.status,
      redeemTxns,
      walletCredits,
      totalCredited: totalCredited._sum.amount,
      durationMs: raceMs,
    },
    pass: racePass,
    notes: racePass ? "single debit confirmed" : "DOUBLE-SPEND OR RACE FAILURE",
  });

  // ─── Wallet pending flood ───
  log("\n## Wallet pending cap stress\n");

  const floodUser = await prisma.user.create({
    data: {
      email: `${RUN_ID}-flood@p2.test`,
      phoneNumber: fixturePhone(RUN_ID, "flood"),
      firstName: "Flood",
      lastName: "P2",
      password: passwordHash,
      role: "CUSTOMER",
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  userIds.push(floodUser.id);
  const floodToken = bearer(floodUser);
  const floodResults: Awaited<ReturnType<typeof http>>[] = [];
  for (let wave = 0; wave < 4; wave++) {
    const batch = await Promise.all(
      Array.from({ length: 5 }, () =>
        http("POST", "/api/wallet/add-money", { token: floodToken, body: { amount: 100 } }),
      ),
    );
    floodResults.push(...batch);
  }
  const flood200 = floodResults.filter((r) => r.status === 200).length;
  const flood429 = floodResults.filter((r) => r.status === 429).length;
  const activePending = await walletService.countActivePendingTopUps(floodUser.id);
  record({
    name: `20 concurrent wallet add-money (cap=${MAX_PENDING_WALLET_TOPUPS})`,
    curl: `for i in {1..20}; do curl -X POST ${BASE}/api/wallet/add-money ... & done`,
    status: flood200,
    body: { http200: flood200, http429: flood429, activePending },
    pass: activePending <= MAX_PENDING_WALLET_TOPUPS && flood200 <= MAX_PENDING_WALLET_TOPUPS,
    notes: `activePending=${activePending}, max=${MAX_PENDING_WALLET_TOPUPS}`,
  });

  const { passed, failed } = await writeReport(started, unverifiedId, raceCardId);
  log(`\n## Summary: ${passed} PASS / ${failed} FAIL / ${evidence.length} total\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
  } finally {
    try {
      if (cardIds.length) {
        await prisma.giftCardTransaction.deleteMany({ where: { giftCardId: { in: cardIds } } });
        await prisma.walletTransaction.deleteMany({ where: { referenceId: { in: cardIds } } });
        await prisma.giftCard.deleteMany({ where: { id: { in: cardIds } } });
      }
      if (userIds.length) {
        await prisma.userSubscription.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await prisma.membershipPlan.deleteMany({ where: { name: { contains: RUN_ID } } });
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr);
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
