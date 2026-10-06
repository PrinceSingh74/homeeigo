/**
 * Split (wallet + gateway) booking refund — isolated CONTROL. homigo_test only; no real gateway.
 *
 * Runs the real split checkout (initiateSplit → verifySplit) and the real cancellation, then measures
 * where every rupee went. The gateway leg uses the product's own dev path, which is selected ONLY when
 * Razorpay keys are absent: NODE_ENV=test makes load-env apply .env.test (empty keys) over .env. The
 * script refuses to touch money unless that is proven at runtime.
 *
 *   NODE_ENV=test REDIS_URL=redis://localhost:6380 HTTPS_PROXY=... bun scripts/chaos/split-refund-control.ts
 */
import { directInsertLiveFlags } from "../../src/lib/catalog-governance";
if (process.env.NODE_ENV !== "test") {
  console.error("REFUSED: NODE_ENV must be 'test' so .env.test (no gateway keys) overrides .env");
  process.exit(2);
}
const egressAttempts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    egressAttempts.push(host);
    throw new Error(`EGRESS_REFUSED ${host}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

await import("../../src/load-env");
const prisma = (await import("../../src/lib/prisma")).default;
const { razorpayService } = await import("../../src/services/razorpay.service");
const { paymentMocksAllowed } = await import("../../src/lib/payment-mocks");
const { walletService } = await import("../../src/services/wallet.service");
const { walletCheckoutService } = await import("../../src/services/wallet-checkout.service");
const { bookingService } = await import("../../src/services/booking.service");
const { bookingRefundService } = await import("../../src/services/booking-refund.service");
const { financialIntegrityService } = await import("../../src/services/financial-integrity.service");

// ── safety preconditions (all must hold before any money moves) ──
const db = ((await prisma.$queryRawUnsafe(`SELECT current_database() AS d`)) as Array<{ d: string }>)[0]?.d;
const safety = {
  nodeEnv: process.env.NODE_ENV,
  database: db,
  redis: (process.env.REDIS_URL ?? "").replace(/\/\/[^@]*@/, "//***@"),
  gatewayConfigured: razorpayService.isConfigured,
  paymentMocksAllowed: paymentMocksAllowed(),
  appEnv: process.env.APP_ENV ?? "",
  httpsProxy: process.env.HTTPS_PROXY ?? "",
};
console.log("SAFETY", JSON.stringify(safety));
if (db !== "homigo_test" || safety.gatewayConfigured || !/:6380\b/.test(safety.redis) || safety.httpsProxy !== "http://127.0.0.1:9") {
  console.error("REFUSED: a safety precondition does not hold");
  process.exit(2);
}

const RUN = `SPL-${Date.now().toString(36)}`;
const TOTAL = 1000, WALLET = 400, GATEWAY = 600;
const one = async (sql: string, ...a: unknown[]) => ((await prisma.$queryRawUnsafe(sql, ...a)) as Array<Record<string, unknown>>)[0] ?? {};
const gap = async () => {
  const r = await one(`SELECT (SELECT coalesce(sum(wallet_balance),0)::float FROM users) ops,
    (SELECT coalesce(sum(l.credit-l.debit),0)::float FROM ledger_entries l JOIN ledger_accounts a ON a.id=l.account_id WHERE a.code='CUSTOMER_WALLET') led`);
  return Math.round(((r.ops as number) - (r.led as number)) * 100) / 100;
};
const ledgerHealth = async () => one(`SELECT
  (SELECT count(*)::int FROM (SELECT journal_id FROM ledger_entries GROUP BY 1 HAVING sum(debit_paise)<>sum(credit_paise)) x) unbalanced,
  (SELECT (sum(debit_paise)=sum(credit_paise)) FROM ledger_entries) dr_eq_cr,
  (SELECT count(*)::int FROM users WHERE wallet_balance_paise<0) negative,
  (SELECT count(*)::int FROM payments WHERE refunded_amount > amount + 0.01) payment_overrun`);

// ── fixture: customer funded through the product's own top-up path (dev order, ledger-consistent) ──
const u = await prisma.user.create({
  data: { dataOrigin: "CERTIFICATION", email: `${RUN.toLowerCase()}@spl.test`, phoneNumber: `+9172${String(Date.now()).slice(-8)}`, firstName: "SPL", lastName: "Control",
    password: "x".repeat(20), role: "CUSTOMER", isEmailVerified: true, isPhoneVerified: true, walletBalance: 0 },
});
const topup = await walletService.addMoney(u.id, WALLET);
if ("error" in topup) throw new Error(`top-up ${topup.error}`);
await walletService.verifyTopUp(u.id, { razorpayOrderId: topup.razorpayOrderId, razorpayPaymentId: `pay_dev_${RUN}_topup`, razorpaySignature: "dev_unsigned" });
const service = await prisma.service.create({
  data: { ...directInsertLiveFlags("split-refund-control"), name: `SPL ${RUN}`, slug: `spl-${RUN}`.toLowerCase(), description: "split refund control", category: "cleaning", basePrice: TOTAL, estimatedDuration: 60 },
});
const addr = await prisma.address.create({
  data: { userId: u.id, label: "H", addressLine1: "1 SPL St", city: "Noida", state: "UP", zipCode: "201301", latitude: 28.62, longitude: 77.37 },
});
const booking = await prisma.booking.create({
  data: { dataOrigin: "CERTIFICATION", bookingNumber: `${RUN}-B`, userId: u.id, serviceId: service.id, addressId: addr.id, status: "PENDING",
    scheduledDate: new Date(Date.now() + 72 * 3_600_000), baseAmount: TOTAL, finalAmount: TOTAL, totalAmount: TOTAL,
    paymentStatus: "PENDING", description: `SPL control ${RUN}` },
});
const gap0 = await gap();
const walletBefore = Number((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).walletBalancePaise);

// ── real split checkout ──
const init = await walletCheckoutService.initiateSplit(u.id, booking.id, WALLET);
console.log("INITIATE", JSON.stringify(init));
if (!("mode" in init) || init.mode !== "split") throw new Error("split not initiated");
const payId = `pay_dev_${RUN}`;
const verify = await walletCheckoutService.verifySplit(u.id, {
  razorpayOrderId: init.razorpayOrderId, razorpayPaymentId: payId,
  razorpaySignature: razorpayService.computePaymentSignature(init.razorpayOrderId, payId),
});
console.log("VERIFY", JSON.stringify(verify));

const pay = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
const bPaid = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
const walletDebit = await prisma.walletTransaction.findFirst({ where: { referenceId: booking.id, type: "DEBIT", referenceType: "booking_wallet_payment" } });
const escrowFor = async () => one(`
  SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.code='PLATFORM_ESCROW'),0)::float escrow_net,
         coalesce(sum(l.debit - l.credit) FILTER (WHERE a.code='REFUND_LIABILITY'),0)::float refund_liability_dr,
         coalesce(sum(l.credit - l.debit) FILTER (WHERE a.code='CUSTOMER_WALLET'),0)::float customer_wallet_net,
         coalesce(sum(l.debit - l.credit) FILTER (WHERE a.code='CUSTOMER_FUNDS'),0)::float customer_funds_net,
         array_agg(DISTINCT j.idempotency_key) keys
  FROM journal_entries j JOIN ledger_entries l ON l.journal_id=j.id JOIN ledger_accounts a ON a.id=l.account_id
  WHERE j.idempotency_key = ANY($1::text[])`,
  [`wallet_debit:${walletDebit?.id}`, `booking_payment:${pay.id}`, `wallet_booking_refund:${booking.id}`,
   ...(await prisma.refundRequest.findMany({ where: { paymentId: pay.id }, select: { gatewayRefundId: true } })).map((r) => `refund:${r.gatewayRefundId}`)]);
const before = {
  booking: { paymentStatus: bPaid.paymentStatus, paymentMethod: bPaid.paymentMethod, finalAmount: bPaid.finalAmount },
  walletPaise: Number((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).walletBalancePaise),
  walletDebit: walletDebit ? { amount: walletDebit.amount, key: `wallet_debit:${walletDebit.id}` } : null,
  paymentRow: { amount: pay.amount, amountPaid: pay.amountPaid, method: pay.paymentMethod, status: pay.status, razorpayPaymentId: pay.razorpayPaymentId, metadata: pay.metadata },
  journals: await escrowFor(),
  quoteRefundable: (await bookingRefundService.quoteForBooking(booking.id, "user"))?.refundAmount,
};
console.log("BEFORE", JSON.stringify(before));

// ── real cancellation ──
const quote = await bookingRefundService.quoteForBooking(booking.id, "user");
const cancel = await bookingService.cancel({ userId: u.id }, booking.id, `SPL control ${RUN}`);
for (let i = 0; i < 60; i++) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { refundStatus: true } });
  if (b.refundStatus !== "pending") break;
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, 1500));

const payAfter = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
const bAfter = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
const walletAfter = Number((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).walletBalancePaise);
const walletRefunds = await prisma.walletTransaction.findMany({ where: { referenceId: booking.id, type: "REFUND", status: "COMPLETED" } });
const rr = await prisma.refundRequest.findMany({ where: { paymentId: pay.id }, select: { status: true, amount: true, idempotencyKey: true, gatewayRefundId: true } });
const gatewayRefund = rr.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.amount, 0);
const walletRefund = walletRefunds.reduce((s, t) => s + t.amount, 0);
const after = await escrowFor();
const result = {
  A_quotePromised: quote?.refundAmount,
  A_quoteMessage: quote?.message,
  B_cancelResponse: cancel,
  C_walletCredited: (walletAfter - (before.walletPaise as number)) / 100,
  D_gatewayRefund: gatewayRefund,
  E_walletRefund: walletRefund,
  F_totalCustomerRefund: gatewayRefund + walletRefund,
  G_escrowNetForBooking_before: (before.journals as Record<string, unknown>).escrow_net,
  G_escrowNetForBooking_after: after.escrow_net,
  G_customerWalletNet_after: after.customer_wallet_net,
  H_refundRequests: rr,
  I_refundJournalKeys: after.keys,
  J_booking: { status: bAfter.status, refundAmount: bAfter.refundAmount, refundStatus: bAfter.refundStatus, paymentStatus: bAfter.paymentStatus },
  paymentRowAfter: { status: payAfter.status, refundedAmount: payAfter.refundedAmount, razorpayRefundId: payAfter.razorpayRefundId },
  K_ledger: await ledgerHealth(),
  customerWalletGap: { before: gap0, after: await gap() },
  L_integrity: await financialIntegrityService.validate().then((v) => ({ status: v.status, categories: v.issues.map((i) => i.category) })).catch((e: Error) => e.message),
  legitimatelyRefundable: TOTAL,
  egressAttempts,
  walletBeforeCheckoutPaise: walletBefore,
};
console.log("RESULT", JSON.stringify(result, null, 1));
console.log(`VERDICT total refunded ${result.F_totalCustomerRefund} of legitimately refundable ${TOTAL}; wallet share returned ${walletRefund} of ${WALLET}; gateway ${gatewayRefund} of ${GATEWAY}; fixtures ${RUN}`);
await prisma.$disconnect();
process.exit(0);
