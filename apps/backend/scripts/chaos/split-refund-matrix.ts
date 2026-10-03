/**
 * Split (wallet + gateway) refund — CHARACTERIZATION matrix of the CURRENT code (homigo_test, dev gateway).
 *
 * Nothing here expects a fix. Each case records where the money went and checks the invariants that
 * must hold regardless (no double gateway refund, no over-refund, no second journal, balanced ledger,
 * no wallet drift). The missing wallet share is recorded as the defect's expression, not as a failure.
 *
 *   NODE_ENV=test REDIS_URL=redis://localhost:6380 HTTPS_PROXY=http://127.0.0.1:9 ... bun scripts/chaos/split-refund-matrix.ts [tag]
 */
import { spawn } from "node:child_process";

if (process.env.NODE_ENV !== "test") {
  console.error("REFUSED: NODE_ENV must be 'test' (.env.test has no gateway keys)");
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
const { walletService } = await import("../../src/services/wallet.service");
const { walletCheckoutService } = await import("../../src/services/wallet-checkout.service");
const { bookingService } = await import("../../src/services/booking.service");
const { bookingRefundService } = await import("../../src/services/booking-refund.service");
const { financialIntegrityService } = await import("../../src/services/financial-integrity.service");
const { notificationService } = await import("../../src/services/notification.service");
const { roomManager } = await import("../../src/lib/websocket");

const db = ((await prisma.$queryRawUnsafe(`SELECT current_database() AS d`)) as Array<{ d: string }>)[0]?.d;
if (db !== "homigo_test" || razorpayService.isConfigured || !/:6380\b|:6399\b/.test(process.env.REDIS_URL ?? "") || process.env.HTTPS_PROXY !== "http://127.0.0.1:9") {
  console.error(`REFUSED: db=${db} gatewayConfigured=${razorpayService.isConfigured} redis=${process.env.REDIS_URL} proxy=${process.env.HTTPS_PROXY}`);
  process.exit(2);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Count real gateway-refund attempts (dev path) without changing their behaviour.
let gatewayRefundCalls = 0;
{
  const orig = razorpayService.executeGatewayRefund.bind(razorpayService);
  (razorpayService as unknown as { executeGatewayRefund: typeof orig }).executeGatewayRefund = async (o) => {
    gatewayRefundCalls++;
    return orig(o);
  };
}

// ── child modes ──
if (process.argv[2] === "--child") {
  const [, , , mode, bookingId, userId] = process.argv;
  if (mode === "crash-before-refund") {
    (bookingRefundService as unknown as { processCancellationRefund: () => Promise<never> }).processCancellationRefund = () => new Promise<never>(() => {});
  }
  if (mode === "crash-in-gateway") {
    // The refund request is committed as REFUNDING and the payment as REFUNDING; the process dies
    // before the gateway answers.
    (razorpayService as unknown as { executeGatewayRefund: () => Promise<never> }).executeGatewayRefund = () => {
      console.log("IN_GATEWAY");
      return new Promise<never>(() => {});
    };
  }
  const r = await bookingService.cancel({ userId: userId! }, bookingId!, `SPM ${mode}`);
  console.log(`CANCELLED ${JSON.stringify(r)}`);
  if (mode === "redis-down") {
    await sleep(4000);
    console.log("DONE");
    process.exit(0);
  }
  await new Promise(() => {});
}

const RUN = `SPM-${process.argv[2] ?? "p"}-${Date.now().toString(36)}`;
const one = async (sql: string, ...a: unknown[]) => ((await prisma.$queryRawUnsafe(sql, ...a)) as Array<Record<string, unknown>>)[0] ?? {};
const gap = async () => {
  const r = await one(`SELECT (SELECT coalesce(sum(wallet_balance),0)::float FROM users) ops,
    (SELECT coalesce(sum(l.credit-l.debit),0)::float FROM ledger_entries l JOIN ledger_accounts a ON a.id=l.account_id WHERE a.code='CUSTOMER_WALLET') led`);
  return Math.round(((r.ops as number) - (r.led as number)) * 100) / 100;
};
const service = await prisma.service.create({
  data: { name: `SPM ${RUN}`, slug: `spm-${RUN}`.toLowerCase(), description: "split matrix", category: "cleaning", basePrice: 1000, estimatedDuration: 60 },
});
let seq = 0;

async function splitPaid(total: number, walletShare: number, hoursAhead = 72) {
  seq++;
  const u = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION", email: `${RUN.toLowerCase()}-${seq}@spm.test`, phoneNumber: `+9173${String(Date.now() + seq).slice(-8)}`, firstName: "SPM", lastName: `C${seq}`,
      password: "x".repeat(20), role: "CUSTOMER", isEmailVerified: true, isPhoneVerified: true, walletBalance: 0 },
  });
  const t = await walletService.addMoney(u.id, walletShare);
  if ("error" in t) throw new Error(t.error);
  await walletService.verifyTopUp(u.id, { razorpayOrderId: t.razorpayOrderId, razorpayPaymentId: `pay_dev_${RUN}_${seq}_t`, razorpaySignature: "dev_unsigned" });
  const a = await prisma.address.create({ data: { userId: u.id, label: "H", addressLine1: "1 SPM St", city: "Noida", state: "UP", zipCode: "201301", latitude: 28.62, longitude: 77.37 } });
  const b = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION", bookingNumber: `${RUN}-${seq}`, userId: u.id, serviceId: service.id, addressId: a.id, status: "PENDING",
      scheduledDate: new Date(Date.now() + hoursAhead * 3_600_000), baseAmount: total, finalAmount: total, totalAmount: total, paymentStatus: "PENDING", description: `SPM ${RUN}` },
  });
  const init = await walletCheckoutService.initiateSplit(u.id, b.id, walletShare);
  if (!("mode" in init) || init.mode !== "split") throw new Error(`initiate ${JSON.stringify(init)}`);
  const pid = `pay_dev_${RUN}_${seq}`;
  const v = await walletCheckoutService.verifySplit(u.id, { razorpayOrderId: init.razorpayOrderId, razorpayPaymentId: pid, razorpaySignature: razorpayService.computePaymentSignature(init.razorpayOrderId, pid) });
  if (!("ok" in v)) throw new Error(`verify ${JSON.stringify(v)}`);
  return { bookingId: b.id, userId: u.id, total, walletShare, gatewayShare: total - walletShare, gap0: await gap(), calls0: gatewayRefundCalls };
}
type F = Awaited<ReturnType<typeof splitPaid>>;

async function cancelledUnrefunded(total: number, walletShare: number) {
  const f = await splitPaid(total, walletShare);
  const svc = bookingRefundService as unknown as { processCancellationRefund: (...a: unknown[]) => Promise<unknown> };
  const orig = svc.processCancellationRefund;
  svc.processCancellationRefund = () => new Promise(() => {});
  try { await bookingService.cancel({ userId: f.userId }, f.bookingId, `SPM ${RUN}`); } finally { svc.processCancellationRefund = orig; }
  return f;
}
async function settle(bookingId: string) {
  for (let i = 0; i < 60; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") break;
    await sleep(100);
  }
  await sleep(500);
}

const rows: Array<Record<string, unknown>> = [];
let invariantFailures = 0;
async function measure(id: string, f: F, legit: number, note: unknown = "") {
  const pay = await prisma.payment.findUniqueOrThrow({ where: { bookingId: f.bookingId } });
  const rr = await prisma.refundRequest.findMany({ where: { paymentId: pay.id } });
  const gatewayRefund = rr.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.amount, 0);
  const walletRefunds = await prisma.walletTransaction.findMany({ where: { referenceId: f.bookingId, type: "REFUND", status: "COMPLETED" } });
  const walletRefund = walletRefunds.reduce((s, t) => s + t.amount, 0);
  const refundJournals = (await one(`SELECT count(*)::int n FROM journal_entries WHERE idempotency_key = ANY($1::text[])`,
    rr.filter((r) => r.gatewayRefundId).map((r) => `refund:${r.gatewayRefundId}`))).n as number;
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
  const g = await gap();
  const calls = gatewayRefundCalls - f.calls0;
  const inv = {
    oneGatewayRefundPerKey: new Set(rr.filter((r) => r.status === "COMPLETED").map((r) => r.idempotencyKey)).size === rr.filter((r) => r.status === "COMPLETED").length,
    journalPerCompletedGatewayRefund: refundJournals === rr.filter((r) => r.status === "COMPLETED").length,
    paymentRefundedMatchesRequests: Math.abs(pay.refundedAmount - gatewayRefund) < 0.005,
    noGatewayOverrun: pay.refundedAmount <= pay.amount + 0.005,
    noTotalOverrun: gatewayRefund + walletRefund <= f.total + 0.005,
    noWalletDrift: Math.abs(g - f.gap0) < 0.005,
  };
  const broken = Object.entries(inv).filter(([, v]) => !v).map(([k]) => k);
  if (broken.length) invariantFailures++;
  const row = {
    id, legit, gatewayRefund, walletRefund, total: gatewayRefund + walletRefund, missing: Math.round((legit - gatewayRefund - walletRefund) * 100) / 100,
    walletShare: f.walletShare, gatewayShare: f.gatewayShare, gatewayRefundCalls: calls,
    refundRequests: rr.map((r) => `${r.status}:${r.amount}`), paymentStatus: pay.status,
    booking: `${b.status}/${b.refundStatus}/${b.refundAmount}`, invariants: broken.length ? `BROKEN ${broken.join(",")}` : "hold", note,
  };
  rows.push(row);
  console.log(`${broken.length ? "INV-FAIL" : "CASE"} ${JSON.stringify(row)}`);
}

function child(mode: string, f: F, env: Record<string, string> = {}) {
  const p = spawn(process.execPath, [import.meta.path, "--child", mode, f.bookingId, f.userId], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += String(d)));
  p.stderr.on("data", (d) => (out += String(d)));
  return { p, out: () => out };
}
async function waitFor(fn: () => boolean, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
  return false;
}

console.log(`run ${RUN} db ${db} gatewayConfigured=${razorpayService.isConfigured} at ${new Date().toISOString()}`);

// S1 full (free tier)
{ const f = await splitPaid(1000, 400); const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
  const r = await bookingService.cancel({ userId: f.userId }, f.bookingId, "SPM"); await settle(f.bookingId);
  await measure("S1 full refund (free tier)", f, 1000, { quote: q?.refundAmount, message: q?.message, response: (r as { refundAmount?: number }).refundAmount }); }
// S2 partial (standard tier, 90%)
{ const f = await splitPaid(1000, 400, 10); const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
  await bookingService.cancel({ userId: f.userId }, f.bookingId, "SPM"); await settle(f.bookingId);
  await measure("S2 partial refund (standard tier 90%)", f, 900, { quote: q?.refundAmount, fee: q?.feeAmount }); }
// S3 repeated
{ const f = await splitPaid(1000, 400); await bookingService.cancel({ userId: f.userId }, f.bookingId, "SPM"); await settle(f.bookingId);
  const again = []; for (let i = 0; i < 3; i++) again.push((await bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "rep", cancelledBy: "user", refundAmount: 600 })).status);
  await measure("S3 repeated refund ×3", f, 1000, { repeats: again }); }
// S4 concurrent
{ const f = await cancelledUnrefunded(1000, 400);
  const rs = await Promise.all(Array.from({ length: 8 }, () => bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "x8", cancelledBy: "user", refundAmount: 600 })));
  await measure("S4 8 concurrent refunds", f, 1000, { statuses: rs.map((r) => r.status) }); }
// S5 cancel retry
{ const f = await splitPaid(1000, 400);
  const rs = await Promise.all(Array.from({ length: 8 }, () => bookingService.cancel({ userId: f.userId }, f.bookingId, "SPM x8"))); await settle(f.bookingId);
  await measure("S5 customer cancel ×8 concurrent", f, 1000, { winners: rs.filter((r) => "status" in r).length }); }
// S6 ambiguous + retry
{ const f = await cancelledUnrefunded(1000, 400);
  const inflight = bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "amb", cancelledBy: "user", refundAmount: 600 });
  const first = await Promise.race([inflight, sleep(1).then(() => "NO_RESPONSE")]);
  const retry = await bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "amb retry", cancelledBy: "user", refundAmount: 600 });
  const late = await inflight;
  await measure("S6 ambiguous response + retry", f, 1000, { first, retry: retry.status, original: late.status }); }
// S7 + S9 crash before refund, then every retry path the product has
{ const f = await splitPaid(1000, 400); const c = child("crash-before-refund", f);
  const armed = await waitFor(() => c.out().includes("CANCELLED"), 60_000); c.p.kill("SIGKILL"); await sleep(1500);
  const r1 = await bookingRefundService.retryFailedRefunds(25);
  const r2 = await bookingRefundService.recoverStrandedCancellationRefunds(25, new Date(), 0);
  await measure("S7/S9 crash after cancel commit, before refund → retry paths run", f, 1000, { armed, retryFailedRefunds: r1, walletSweep: r2 }); }
// S8 + S9 crash inside the gateway call
{ const f = await splitPaid(1000, 400); const c = child("crash-in-gateway", f);
  const armed = await waitFor(() => c.out().includes("IN_GATEWAY"), 60_000); c.p.kill("SIGKILL"); await sleep(1500);
  const r1 = await bookingRefundService.retryFailedRefunds(25);
  const r2 = await bookingRefundService.recoverStrandedCancellationRefunds(25, new Date(), 0);
  const direct = await bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "manual retry", cancelledBy: "user", refundAmount: 600 });
  await measure("S8/S9 crash during gateway refund → retry paths + a direct retry", f, 1000, { armed, retryFailedRefunds: r1, walletSweep: r2, directRetry: direct }); }
// S10 admin refund
{ const f = await splitPaid(1000, 400);
  const full = await bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: f.userId, amount: 1000, reason: "admin full" });
  const walletPart = await bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: f.userId, amount: 400, reason: "admin wallet share" });
  await measure("S10 admin refund: ₹1000 then ₹400", f, 1000, { adminFull: full, adminWalletShare: walletPart }); }
// S11 outbox redelivery
{ const { bootstrapEventConsumers } = await import("../../src/events/consumers/index");
  const { processOutboxBatch } = await import("../../src/events/core/outbox-processor");
  const { replayOutboxEvent } = await import("../../src/events/core/replay");
  bootstrapEventConsumers();
  const f = await splitPaid(1000, 400); await bookingService.cancel({ userId: f.userId }, f.bookingId, "SPM"); await settle(f.bookingId);
  for (let i = 0; i < 10; i++) await processOutboxBatch();
  const ev = await prisma.eventOutbox.findFirst({ where: { aggregateId: f.bookingId, eventType: "homigo.booking.cancelled" }, select: { eventId: true } });
  const rep = ev ? [await replayOutboxEvent({ eventId: ev.eventId, force: true }), await replayOutboxEvent({ eventId: ev.eventId, force: true })] : [];
  await measure("S11 cancellation event delivered + force-replayed ×2", f, 1000, { event: Boolean(ev), replays: rep.map((r) => r.reason) }); }
// S12 notification failure
{ const f = await splitPaid(1000, 400); // fixture first: its top-up notifies
  const ns = notificationService as unknown as Record<string, unknown>; const saved = { a: ns.createForUserDetached, b: ns.notifyBookingCancelled };
  let thrown = 0; const boom = () => { thrown++; throw new Error("SPM notification outage"); };
  ns.createForUserDetached = boom; ns.notifyBookingCancelled = boom;
  try { await bookingService.cancel({ userId: f.userId }, f.bookingId, "SPM"); await settle(f.bookingId); } finally { ns.createForUserDetached = saved.a; ns.notifyBookingCancelled = saved.b; }
  await measure("S12 notification failure", f, 1000, { thrown }); }
// S13 realtime failure
{ const f = await splitPaid(1000, 400);
  const rm = roomManager as unknown as Record<string, unknown>; const saved = { b: rm.broadcast, s: rm.sendToUser };
  let thrown = 0; rm.broadcast = () => { thrown++; throw new Error("SPM realtime outage"); }; rm.sendToUser = () => { thrown++; throw new Error("SPM realtime outage"); };
  try { await bookingService.cancel({ userId: f.userId }, f.bookingId, "SPM"); await settle(f.bookingId); } finally { rm.broadcast = saved.b; rm.sendToUser = saved.s; }
  await measure("S13 realtime failure", f, 1000, { thrown }); }
// S14 Redis unavailable
{ const f = await splitPaid(1000, 400); const c = child("redis-down", f, { REDIS_URL: "redis://127.0.0.1:6399" });
  await waitFor(() => c.out().includes("DONE"), 90_000); c.p.kill("SIGKILL"); await sleep(500);
  await measure("S14 Redis unavailable", f, 1000, { child: c.out().split("\n").find((l) => l.startsWith("CANCELLED"))?.slice(0, 160) ?? c.out().slice(-200) }); }
// S15 reconciliation after refund
{ const integ = await financialIntegrityService.validate().then((v) => ({ status: v.status, categories: v.issues.map((i) => i.category) })).catch((e: Error) => e.message);
  const escrow = await one(`SELECT coalesce(sum(l.credit-l.debit),0)::float v FROM journal_entries j JOIN ledger_entries l ON l.journal_id=j.id JOIN ledger_accounts a ON a.id=l.account_id
     WHERE a.code='PLATFORM_ESCROW' AND j.idempotency_key IN (SELECT 'wallet_debit:'||w.id FROM wallet_transactions w JOIN bookings b ON b.id=w.reference_id WHERE b.description=$1 AND w.type::text='DEBIT')`, `SPM ${RUN}`);
  const ledger = await one(`SELECT (SELECT count(*)::int FROM (SELECT journal_id FROM ledger_entries GROUP BY 1 HAVING sum(debit_paise)<>sum(credit_paise)) x) unbalanced,
     (SELECT (sum(debit_paise)=sum(credit_paise)) FROM ledger_entries) dr_eq_cr, (SELECT count(*)::int FROM payments WHERE refunded_amount > amount + 0.01) payment_overrun`);
  console.log(`S15 RECONCILIATION ${JSON.stringify({ integrity: integ, walletSharesStillInEscrowThisRun: escrow.v, ledger })}`); }

// drain whatever this run emitted
{ const { processOutboxBatch } = await import("../../src/events/core/outbox-processor");
  for (let i = 0; i < 20; i++) { const n = (await one(`SELECT count(*)::int n FROM event_outbox WHERE status::text IN ('PENDING','PROCESSING')`)).n as number; if (!n) break; await processOutboxBatch(); await sleep(200); } }
const stuck = await one(`SELECT count(*)::int n FROM refund_requests rr JOIN payments p ON p.id=rr.payment_id JOIN bookings b ON b.id=p.booking_id WHERE b.description=$1 AND rr.status::text IN ('REFUNDING','PROCESSING','INDETERMINATE')`, `SPM ${RUN}`);
console.log(`SUMMARY ${RUN}: cases ${rows.length}; invariant failures ${invariantFailures}; wallet share refunded in ${rows.filter((r) => (r.walletRefund as number) > 0).length}/${rows.length}; total missing ₹${rows.reduce((s, r) => s + (r.missing as number), 0)}; refund requests left non-terminal ${stuck.n}; egress ${egressAttempts.length}`);
await prisma.$disconnect();
process.exit(0);
