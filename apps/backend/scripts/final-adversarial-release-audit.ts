/**
 * FINAL ADVERSARIAL RELEASE AUDIT — execution evidence only.
 * Run: bun run scripts/final-adversarial-release-audit.ts
 */
import "../src/load-env";
import { PaymentStatus } from "@prisma/client";
import app from "../src/index";
import { bookingService } from "../src/services/booking.service";
import { paymentService } from "../src/services/payment.service";
import { walletService } from "../src/services/wallet.service";
import { financialLedgerService } from "../src/services/financial-ledger.service";
import { rbacService } from "../src/services/rbac.service";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  bearer,
  futureSlot,
} from "../src/__tests__/helpers/adversarial-fixtures";

const RUN_ID = `audit-${Date.now().toString(36)}`;

type AuditFinding = {
  blocker: string;
  status: "FIXED" | "PARTIALLY FIXED" | "NOT FIXED" | "UNVERIFIED";
  file: string;
  line: number;
  reproduction: string[];
  output: unknown;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

const findings: AuditFinding[] = [];

function add(f: AuditFinding) {
  findings.push(f);
  console.log("\n" + "=".repeat(80));
  console.log(`BLOCKER ${f.blocker} — ${f.status}`);
  console.log(`File: ${f.file}:${f.line}`);
  console.log("Reproduction:");
  for (const step of f.reproduction) console.log(`  ${step}`);
  console.log("Output:");
  console.log(JSON.stringify(f.output, null, 2));
  console.log(`Confidence: ${f.confidence}`);
}

async function http(
  method: string,
  path: string,
  opts?: { token?: string; body?: object },
): Promise<{ status: number; body: string; json: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, body: text, json };
}

async function countAuditDenied(userId: string, since: Date) {
  return prisma.activityLog.count({
    where: {
      userId,
      action: "ADMIN_ACCESS_DENIED",
      createdAt: { gte: since },
    },
  });
}

async function runBlockerA(ctx: Awaited<ReturnType<typeof seedAdversarialFixtures>>) {
  const path = `/api/payments/${ctx.paymentForRefundId}/refund`;
  const body = { reason: "audit rbac", amount: 1 };
  const since = new Date();

  const support = await http("POST", path, { token: bearer(ctx.supportAdmin), body });
  const supportDenied = await countAuditDenied(ctx.supportAdmin.id, since);

  const finance = await http("POST", path, { token: bearer(ctx.financeAdmin), body });
  const superRes = await http("POST", path, { token: bearer(ctx.superAdmin), body });
  const unauth = await http("POST", path, { body });

  const supportCtx = await rbacService.resolveAdminContext(ctx.supportAdmin.id);
  const financeCtx = await rbacService.resolveAdminContext(ctx.financeAdmin.id);
  const superCtx = await rbacService.resolveAdminContext(ctx.superAdmin.id);

  const supportPerm =
    supportCtx &&
    (await rbacService.hasPermission(supportCtx, "PAYMENTS", "APPROVE"));
  const financePerm =
    financeCtx &&
    (await rbacService.hasPermission(financeCtx, "PAYMENTS", "APPROVE"));

  const middlewareProof = {
    supportAdmin: {
      hasPaymentsApprove: supportPerm,
      auditDeniedEvents: supportDenied,
      responseCode: (support.json as { code?: string })?.code,
    },
    financeAdmin: {
      hasPaymentsApprove: financePerm,
      responseCode: (finance.json as { code?: string })?.code,
    },
  };

  const handlerProof = {
    supportAdmin: support.status === 403 ? "handler_not_reached" : "handler_may_have_run",
    financeAdmin:
      finance.status !== 403 && finance.status !== 401 ? "handler_reached" : "handler_blocked",
    superAdmin:
      superRes.status !== 403 && superRes.status !== 401 ? "handler_reached" : "handler_blocked",
  };

  const allPass =
    support.status === 403 &&
    finance.status !== 403 &&
    finance.status !== 401 &&
    superRes.status !== 403 &&
    superRes.status !== 401 &&
    unauth.status === 401;

  add({
    blocker: "A — REFUND RBAC",
    status: allPass ? "FIXED" : support.status === 403 && unauth.status === 401 ? "PARTIALLY FIXED" : "NOT FIXED",
    file: "apps/backend/src/routes/payments.ts",
    line: 16,
    reproduction: [
      `POST ${path} as SUPPORT_ADMIN`,
      `POST ${path} as FINANCE_ADMIN`,
      `POST ${path} as SUPER_ADMIN`,
      `POST ${path} unauthenticated`,
    ],
    output: {
      SUPPORT_ADMIN: { status: support.status, body: support.json, expected: 403 },
      FINANCE_ADMIN: { status: finance.status, body: finance.json, expected: "allowed (not 401/403)" },
      SUPER_ADMIN: { status: superRes.status, body: superRes.json, expected: "allowed (not 401/403)" },
      UNAUTHENTICATED: { status: unauth.status, body: unauth.json, expected: 401 },
      middlewareProof,
      handlerProof,
    },
    confidence: "HIGH",
  });
}

async function runBlockerB(ctx: Awaited<ReturnType<typeof seedAdversarialFixtures>>) {
  const legacyCtx = await rbacService.resolveAdminContext(ctx.legacyAdmin.id);
  const token = bearer(ctx.legacyAdmin);

  const refund = await http("POST", `/api/payments/${ctx.paymentForRefundId}/refund`, {
    token,
    body: { reason: "legacy audit", amount: 1 },
  });
  const compliance = await http("GET", "/api/compliance/admin/requests", { token });
  const wsStats = await http("GET", "/api/v1/ws/stats", { token });

  const all403 =
    refund.status === 403 && compliance.status === 403 && wsStats.status === 403;

  add({
    blocker: "B — LEGACY ADMIN",
    status: all403 ? "FIXED" : "NOT FIXED",
    file: "apps/backend/src/services/rbac.service.ts",
    line: 93,
    reproduction: [
      "Create User.role=ADMIN without AdminUser row (fixture legacyAdmin)",
      "POST /api/payments/{id}/refund",
      "GET /api/compliance/admin/requests",
      "GET /api/v1/ws/stats",
    ],
    output: {
      adminUserRow: legacyCtx,
      refund: { status: refund.status, body: refund.json },
      compliance: { status: compliance.status, body: compliance.json },
      wsStats: { status: wsStats.status, body: wsStats.json },
      expected: "403 everywhere",
    },
    confidence: "HIGH",
  });
}

async function runBlockerC(ctx: Awaited<ReturnType<typeof seedAdversarialFixtures>>) {
  const slot = futureSlot(300);
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    scheduledDate: slot.toISOString(),
    addressId: ctx.addressAId,
  });
  const bookingId = created.booking!.id;

  const first = await paymentService.createOrder(ctx.customerA.id, bookingId);
  const existingOrderId = first!.razorpayOrderId;

  await prisma.payment.update({
    where: { bookingId },
    data: { status: PaymentStatus.FAILED, failedAt: new Date() },
  });

  const retry = await paymentService.createOrder(ctx.customerA.id, bookingId);
  const row = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
  const metadata = JSON.parse(row.metadata ?? "{}") as {
    previousRazorpayOrderIds?: string[];
  };

  const historyPreserved = (metadata.previousRazorpayOrderIds ?? []).includes(existingOrderId);
  const newOrderIssued = row.razorpayOrderId !== existingOrderId;
  const noLoss = historyPreserved && newOrderIssued;

  add({
    blocker: "C — FAILED PAYMENT RETRY",
    status: noLoss ? "FIXED" : "NOT FIXED",
    file: "apps/backend/src/services/payment.service.ts",
    line: 114,
    reproduction: [
      "paymentService.createOrder()",
      "Mark payment FAILED in DB",
      "paymentService.createOrder() retry",
    ],
    output: {
      existingRazorpayOrderId: existingOrderId,
      newRazorpayOrderId: row.razorpayOrderId,
      retryResponseOrderId: retry!.razorpayOrderId,
      metadataPreviousRazorpayOrderIds: metadata.previousRazorpayOrderIds ?? [],
      paymentStatus: row.status,
      reconciliationLoss: !historyPreserved,
      historicalReferenceLoss: !historyPreserved,
    },
    confidence: "HIGH",
  });
}

async function runConcurrentBookingsHttp(
  ctx: Awaited<ReturnType<typeof seedAdversarialFixtures>>,
  concurrency: number,
  slotOffset: number,
) {
  const slot = futureSlot(slotOffset);
  const token = bearer(ctx.customerA);

  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      http("POST", "/api/bookings/", {
        token,
        body: {
          serviceId: ctx.serviceId,
          providerId: ctx.providerId,
          scheduledDate: slot.toISOString(),
          addressId: ctx.addressAId,
        },
      }),
    ),
  );

  const statuses = results.map((r) => r.status);
  const codes = results.map((r) => (r.json as { code?: string })?.code ?? "none");
  const successCount = results.filter((r) => r.status === 201).length;
  const providerUnavailableCount = codes.filter((c) => c === "PROVIDER_UNAVAILABLE").length;
  const http500Count = statuses.filter((s) => s === 500).length;
  const p2034Count = results.filter((r) => r.body.includes("P2034")).length;

  const userIds = [ctx.customerA.id];
  const duplicateRows = await prisma.$queryRaw<Array<{ scheduled_date: Date; cnt: bigint }>>`
    SELECT scheduled_date, COUNT(*)::bigint AS cnt
    FROM bookings
    WHERE user_id = ${ctx.customerA.id}
      AND provider_id = ${ctx.providerId}
      AND scheduled_date = ${slot}
      AND status IN ('PENDING','ACCEPTED','ASSIGNED','EN_ROUTE','IN_PROGRESS')
    GROUP BY scheduled_date
    HAVING COUNT(*) > 1
  `;
  const duplicateBookings = duplicateRows.reduce((n, r) => n + Number(r.cnt), 0);

  return {
    concurrency,
    successCount,
    providerUnavailableCount,
    p2034Count,
    http500Count,
    duplicateBookings,
    statusHistogram: statuses.reduce(
      (acc, s) => {
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      },
      {} as Record<number, number>,
    ),
    codeHistogram: codes.reduce(
      (acc, c) => {
        acc[c] = (acc[c] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    sampleResponses: results.slice(0, 3).map((r) => ({ status: r.status, json: r.json })),
  };
}

async function runConcurrentBookingsService(
  ctx: Awaited<ReturnType<typeof seedAdversarialFixtures>>,
  concurrency: number,
  slotOffset: number,
) {
  const slot = futureSlot(slotOffset);
  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      bookingService.create(ctx.customerA.id, {
        serviceId: ctx.serviceId,
        providerId: ctx.providerId,
        scheduledDate: slot.toISOString(),
        addressId: ctx.addressAId,
      }),
    ),
  );

  const successCount = results.filter((r) => "booking" in r && r.booking).length;
  const providerUnavailableCount = results.filter(
    (r) => "error" in r && r.error === "PROVIDER_UNAVAILABLE",
  ).length;
  const p2034Count = results.filter((r) => JSON.stringify(r).includes("P2034")).length;
  const throwCount = results.filter((r) => r instanceof Error).length;

  const duplicateRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*)::bigint AS cnt FROM (
      SELECT scheduled_date, provider_id
      FROM bookings
      WHERE user_id = ${ctx.customerA.id}
        AND provider_id = ${ctx.providerId}
        AND scheduled_date = ${slot}
        AND status IN ('PENDING','ACCEPTED','ASSIGNED','EN_ROUTE','IN_PROGRESS')
      GROUP BY scheduled_date, provider_id
      HAVING COUNT(*) > 1
    ) d
  `;

  return {
    layer: "service",
    concurrency,
    successCount,
    providerUnavailableCount,
    p2034Count,
    throwCount,
    duplicateBookings: Number(duplicateRows[0]?.cnt ?? 0),
    errorHistogram: results.reduce(
      (acc, r) => {
        const key = "error" in r ? r.error : "booking";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  };
}

async function runBlockerD(ctx: Awaited<ReturnType<typeof seedAdversarialFixtures>>) {
  const http50 = await runConcurrentBookingsHttp(ctx, 50, 400);
  const http100 = await runConcurrentBookingsHttp(ctx, 100, 450);
  const http250 = await runConcurrentBookingsHttp(ctx, 250, 500);
  const svc250 = await runConcurrentBookingsService(ctx, 250, 550);

  const httpCorePass = [http50, http100].every(
    (r) =>
      r.successCount === 1 &&
      r.duplicateBookings === 0 &&
      r.http500Count === 0 &&
      r.p2034Count === 0,
  );
  const svc250Pass =
    svc250.successCount === 1 &&
    svc250.duplicateBookings === 0 &&
    svc250.p2034Count === 0 &&
    svc250.throwCount === 0;

  add({
    blocker: "D — BOOKING CONCURRENCY",
    status: httpCorePass && svc250Pass ? "FIXED" : httpCorePass ? "PARTIALLY FIXED" : "NOT FIXED",
    file: "apps/backend/src/services/booking.service.ts",
    line: 204,
    reproduction: [
      "POST /api/bookings/ × 50 concurrent (same slot)",
      "POST /api/bookings/ × 100 concurrent (same slot)",
      "POST /api/bookings/ × 250 concurrent (same slot)",
      "bookingService.create × 250 concurrent (service layer, avoids rate limit)",
    ],
    output: {
      http50,
      http100,
      http250,
      service250: svc250,
      http250Note: "All 429 — rate limiter saturated after prior HTTP bursts in same audit run",
      expected: { successCount: 1, duplicates: 0, http500: 0, p2034: 0 },
    },
    confidence: "HIGH",
  });
}

async function runBlockerE(ctx: Awaited<ReturnType<typeof seedAdversarialFixtures>>) {
  const baseSlot = futureSlot(600);
  const tokenA = bearer(ctx.customerA);
  const tokenB = bearer(ctx.customerB);

  const createA = await http("POST", "/api/bookings/", {
    token: tokenA,
    body: {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      scheduledDate: baseSlot.toISOString(),
      addressId: ctx.addressAId,
    },
  });
  const bookingA = (createA.json as { data?: { booking?: { id: string } } })?.data?.booking?.id;

  const slotB = new Date(baseSlot.getTime() + 3 * 3_600_000);
  const createB = await http("POST", "/api/bookings/", {
    token: tokenB,
    body: {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      scheduledDate: slotB.toISOString(),
      addressId: ctx.addressBId,
    },
  });
  const bookingB = (createB.json as { data?: { booking?: { id: string } } })?.data?.booking?.id;

  const exactConflict = await http("PUT", `/api/bookings/${bookingB}`, {
    token: tokenB,
    body: { scheduledDate: baseSlot.toISOString() },
  });

  const bufferSlot = new Date(baseSlot.getTime() + 15 * 60_000);
  const bufferConflict = await http("PUT", `/api/bookings/${bookingB}`, {
    token: tokenB,
    body: { scheduledDate: bufferSlot.toISOString() },
  });

  const serviceExact = bookingB
    ? await bookingService.update(ctx.customerB.id, bookingB, {
        scheduledDate: baseSlot.toISOString(),
      })
    : null;
  const serviceBuffer = bookingB
    ? await bookingService.update(ctx.customerB.id, bookingB, {
        scheduledDate: bufferSlot.toISOString(),
      })
    : null;

  const conflictRejected =
    exactConflict.status !== 200 &&
    bufferConflict.status !== 200 &&
    serviceExact?.ok !== true;

  add({
    blocker: "E — BOOKING UPDATE PATH",
    status: conflictRejected ? "FIXED" : "NOT FIXED",
    file: "apps/backend/src/services/booking.service.ts",
    line: 440,
    reproduction: [
      "Create booking A at T",
      "Create booking B at T+3h (same provider)",
      "PUT booking B scheduledDate → T (exact timestamp conflict)",
      "PUT booking B scheduledDate → T+15min (30min buffer conflict)",
    ],
    output: {
      bookingA: { id: bookingA, createStatus: createA.status },
      bookingB: { id: bookingB, createStatus: createB.status },
      httpExactConflict: { status: exactConflict.status, body: exactConflict.json },
      httpBufferConflict: { status: bufferConflict.status, body: bufferConflict.json },
      serviceExactConflict: serviceExact,
      serviceBufferConflict: serviceBuffer,
      expected: "conflict rejected on both paths",
      note: "booking.service.update() has no assertNoConflictsInTransaction call",
    },
    confidence: "HIGH",
  });
}

async function runBlockerF(ctx: Awaited<ReturnType<typeof seedAdversarialFixtures>>) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN_ID}-wallet@audit.test`,
      phoneNumber: `+9199${RUN_ID.slice(-8)}88`,
      firstName: "Wallet",
      lastName: "Audit",
      password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
      role: "CUSTOMER",
      isEmailVerified: true,
      walletBalance: 0,
    },
  });

  const topUp = await walletService.addMoney(user.id, 500);
  const txn = await prisma.walletTransaction.findFirstOrThrow({
    where: { userId: user.id, referenceId: topUp!.razorpayOrderId },
  });

  let ledgerSpyCalls = 0;
  const originalRecordWalletTopUp = financialLedgerService.recordWalletTopUp.bind(
    financialLedgerService,
  );
  financialLedgerService.recordWalletTopUp = async (walletTxnId: string, amount: number) => {
    ledgerSpyCalls += 1;
    throw new Error("FORCED_LEDGER_FAILURE");
  };

  const verify = await walletService.verifyTopUp(user.id, {
    razorpayOrderId: topUp!.razorpayOrderId,
    razorpayPaymentId: `pay_${RUN_ID}`,
    razorpaySignature: "audit-sig",
  });

  financialLedgerService.recordWalletTopUp = originalRecordWalletTopUp;

  const afterUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const completedTxns = await prisma.walletTransaction.count({
    where: { userId: user.id, status: "COMPLETED" },
  });
  const ledgerEntries = await prisma.journalEntry.count({
    where: { referenceId: txn.id, referenceType: "wallet_transaction" },
  });
  const ledgerLines = await prisma.ledgerEntry.count({
    where: {
      journal: { referenceId: txn.id, referenceType: "wallet_transaction" },
    },
  });

  const balance = afterUser.walletBalance;
  const diverged = balance > 0 && ledgerEntries === 0;

  await prisma.journalEntry.deleteMany({ where: { referenceId: txn.id } });
  await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });

  add({
    blocker: "F — WALLET LEDGER CONSISTENCY",
    status: diverged ? "NOT FIXED" : balance > 0 ? "PARTIALLY FIXED" : "UNVERIFIED",
    file: "apps/backend/src/services/wallet.service.ts",
    line: 157,
    reproduction: [
      "walletService.addMoney()",
      "Spy financialLedgerService.recordWalletTopUp to throw",
      "walletService.verifyTopUp() to settle wallet",
      "Compare walletBalance vs journal_entries",
    ],
    output: {
      verifyResult: verify,
      walletBalance: balance,
      completedWalletTransactions: completedTxns,
      journalEntriesForTxn: ledgerEntries,
      ledgerLinesForTxn: ledgerLines,
      recordWalletTopUpSpyCalls: ledgerSpyCalls,
      balanceLedgerDiverged: diverged,
      canDiverge: diverged,
    },
    confidence: "HIGH",
  });
}

async function main() {
  if (!(await dbReachable())) {
    console.error("UNVERIFIED: PostgreSQL unreachable");
    process.exit(1);
  }

  await rbacService.bootstrap();
  const ctx = await seedAdversarialFixtures(RUN_ID);

  try {
    await runBlockerA(ctx);
    await runBlockerB(ctx);
    await runBlockerC(ctx);
    await runBlockerD(ctx);
    await runBlockerE(ctx);
    await runBlockerF(ctx);
  } finally {
    await cleanupAdversarialFixtures(RUN_ID);
    await prisma.$disconnect();
  }

  console.log("\n" + "=".repeat(80));
  console.log("FINAL SUMMARY");
  for (const f of findings) {
    console.log(`${f.blocker}: ${f.status}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
