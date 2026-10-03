/**
 * Wallet-paid booking refund — verification matrix for the Option B fix (homigo_test ONLY).
 *
 * Twelve cases through the real production services, no gateway, no real funds, loopback-only egress.
 * Crash cases run the cancellation in a child process that is hard-killed at the exact seam.
 *
 *   DATABASE_URL=...homigo_test REDIS_URL=redis://localhost:6380 bun scripts/chaos/wallet-refund-matrix.ts [tag]
 *   (internal) ... wallet-refund-matrix.ts --child <mode> <bookingId> <userId>
 */
import { spawn } from "node:child_process";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/\/homigo_test(\?|&|$)/.test(dbUrl.split("?")[0] + "?")) {
  console.error("REFUSED: DATABASE_URL must target homigo_test");
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

const prisma = (await import("../../src/lib/prisma")).default;
const { walletCheckoutService } = await import("../../src/services/wallet-checkout.service");
const { bookingService } = await import("../../src/services/booking.service");
const { bookingRefundService } = await import("../../src/services/booking-refund.service");
const { financialTransactionManager } = await import("../../src/services/financial-transaction-manager.service");
const { financialIntegrityService } = await import("../../src/services/financial-integrity.service");
const { notificationService } = await import("../../src/services/notification.service");
const { roomManager } = await import("../../src/lib/websocket");

const db = ((await prisma.$queryRawUnsafe(`SELECT current_database() AS d`)) as Array<{ d: string }>)[0]?.d;
if (db !== "homigo_test") {
  console.error(`REFUSED: connected database is ${db}`);
  process.exit(2);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── child modes (crash seams) ─────────────────────────────────────────────────────────────────────
if (process.argv[2] === "--child") {
  const [, , , mode, bookingId, userId] = process.argv;
  if (mode === "crash-before-refund") {
    // The cancellation commits; the detached refund never starts (process dies first).
    (bookingRefundService as unknown as { processCancellationRefund: () => Promise<never> }).processCancellationRefund = () =>
      new Promise<never>(() => {});
    const r = await bookingService.cancel({ userId: userId! }, bookingId!, "WRM crash-before-refund");
    console.log(`CANCELLED ${JSON.stringify(r)}`);
    await new Promise(() => {});
  }
  if (mode === "crash-inside-refund") {
    // The refund transaction has written the credit, wallet txn and (pending) journal but not committed.
    const orig = financialTransactionManager.executeWithLedger.bind(financialTransactionManager);
    (financialTransactionManager as unknown as { executeWithLedger: typeof orig }).executeWithLedger = (opts) =>
      orig({
        ...opts,
        mutate: async (tx) => {
          const out = await opts.mutate(tx);
          console.log("IN_TX");
          await new Promise(() => {});
          return out;
        },
      });
    const r = await bookingService.cancel({ userId: userId! }, bookingId!, "WRM crash-inside-refund");
    console.log(`CANCELLED ${JSON.stringify(r)}`);
    await new Promise(() => {});
  }
  if (mode === "redis-down") {
    const r = await bookingService.cancel({ userId: userId! }, bookingId!, "WRM redis-down");
    console.log(`CANCELLED ${JSON.stringify(r)}`);
    await sleep(4000);
    console.log("DONE");
    process.exit(0);
  }
  process.exit(3);
}

// ── parent ────────────────────────────────────────────────────────────────────────────────────────
const RUN = `WRM-${process.argv[2] ?? "p"}-${Date.now().toString(36)}`;
const one = async (sql: string, ...a: unknown[]) =>
  ((await prisma.$queryRawUnsafe(sql, ...a)) as Array<Record<string, unknown>>)[0] ?? {};

async function wholeLedger() {
  const totals = (await one(`SELECT count(*)::int lines, coalesce(sum(debit),0)::float debit_total, coalesce(sum(credit),0)::float credit_total,
                          coalesce(sum(debit_paise),0)::text debit_paise, coalesce(sum(credit_paise),0)::text credit_paise FROM ledger_entries`)) as
    { lines: number; debit_total: number; credit_total: number; debit_paise: string; credit_paise: string };
  return {
    ...totals,
    journals: (await one(`SELECT count(*)::int n FROM journal_entries`)).n,
    unbalanced: (await one(`SELECT count(*)::int n FROM (SELECT journal_id FROM ledger_entries GROUP BY 1 HAVING round(sum(debit)::numeric,2)<>round(sum(credit)::numeric,2) OR sum(debit_paise)<>sum(credit_paise)) x`)).n,
    orphanLines: (await one(`SELECT count(*)::int n FROM ledger_entries l WHERE NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.id=l.journal_id)`)).n,
    walletTxns: (await one(`SELECT count(*)::int n FROM wallet_transactions`)).n,
    refundRequests: (await one(`SELECT count(*)::int n FROM refund_requests`)).n,
    payments: (await one(`SELECT count(*)::int n FROM payments`)).n,
    negativeWallets: (await one(`SELECT count(*)::int n FROM users WHERE wallet_balance_paise<0`)).n,
    userPaiseMismatch: (await one(`SELECT count(*)::int n FROM users WHERE abs(round(wallet_balance::numeric*100)-wallet_balance_paise)>0`)).n,
    txnPaiseMismatch: (await one(`SELECT count(*)::int n FROM wallet_transactions WHERE abs(round(amount::numeric*100)-amount_paise)>0`)).n,
    dupJournalKeys: (await one(`SELECT count(*)::int n FROM (SELECT idempotency_key FROM journal_entries WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*)>1) x`)).n,
    dupWalletKeys: (await one(`SELECT count(*)::int n FROM (SELECT idempotency_key FROM wallet_transactions WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*)>1) x`)).n,
    paymentRefundOverrun: (await one(`SELECT count(*)::int n FROM payments WHERE refunded_amount > amount + 0.01`)).n,
    // Wallet-funded bookings only (no payments row): a booking WITH a payments row takes its ceiling
    // from payments.refunded_amount, checked by paymentRefundOverrun. 33 fixture bookings in homigo_test
    // fake a wallet payments row and have no wallet debit at all; counting them here would be a false alarm.
    walletRefundOverrun: (await one(`SELECT count(*)::int n FROM (SELECT reference_id FROM wallet_transactions w WHERE status::text='COMPLETED'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = w.reference_id) GROUP BY reference_id
        HAVING sum(amount_paise) FILTER (WHERE type::text='REFUND' AND reference_type IN ('booking_cancel_refund','booking_admin_refund'))
             > coalesce(sum(amount_paise) FILTER (WHERE type::text='DEBIT' AND reference_type='booking_wallet_payment'),0)) x`)).n,
    customerWalletOps: (await one(`SELECT coalesce(sum(wallet_balance),0)::float v FROM users`)).v as number,
    customerWalletLedger: (await one(`SELECT coalesce(sum(l.credit-l.debit),0)::float v FROM ledger_entries l JOIN ledger_accounts a ON a.id=l.account_id WHERE a.code='CUSTOMER_WALLET'`)).v as number,
  };
}
const gap = async () => {
  const l = await wholeLedger();
  return Math.round((l.customerWalletOps - l.customerWalletLedger) * 100) / 100;
};

const results: Array<{ id: string; ok: boolean; detail: string }> = [];
function rec(id: string, ok: boolean, detail: string) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
}

const service = await prisma.service.create({
  data: { name: `WRM ${RUN}`, slug: `wrm-${RUN}`.toLowerCase(), description: "wallet refund matrix", category: "cleaning",
    basePrice: 1000, estimatedDuration: 60, availableCities: ["Noida"], tags: ["wrm"] },
});
let seq = 0;
let fixtureFundingRupees = 0;

async function customer(): Promise<{ id: string }> {
  seq++;
  const u = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION", email: `${RUN.toLowerCase()}-${seq}@wrm.test`, phoneNumber: `+9171${String(Date.now() + seq).slice(-8)}`,
      firstName: "WRM", lastName: `C${seq}`, password: "x", role: "CUSTOMER", isEmailVerified: true, isPhoneVerified: true, walletBalance: 0 },
  });
  await prisma.address.create({
    data: { userId: u.id, label: "Home", addressLine1: "1 WRM St", city: "Noida", state: "UP", zipCode: "201301",
      fullAddress: "1 WRM St, Noida", latitude: 28.62, longitude: 77.37, isDefault: true },
  });
  return u;
}

/** A booking paid in full from the wallet through the real checkout. Funding is off-ledger and tracked. */
async function paidBooking(price: number, hoursAhead = 72): Promise<{ bookingId: string; userId: string; gapAfterFunding: number }> {
  const u = await customer();
  const addr = await prisma.address.findFirstOrThrow({ where: { userId: u.id } });
  const b = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION", bookingNumber: `${RUN}-${seq}`, userId: u.id, serviceId: service.id, addressId: addr.id, status: "PENDING",
      scheduledDate: new Date(Date.now() + hoursAhead * 3_600_000), baseAmount: price, finalAmount: price, totalAmount: price,
      paymentStatus: "PENDING", description: `WRM ${RUN}` },
  });
  await prisma.user.update({ where: { id: u.id }, data: { walletBalance: price, walletBalancePaise: BigInt(Math.round(price * 100)) } });
  fixtureFundingRupees += price;
  const g = await gap();
  const pay = await walletCheckoutService.payBookingFromWallet(u.id, b.id);
  if (!("ok" in pay) || !pay.ok) throw new Error(`fixture pay failed ${JSON.stringify(pay)}`);
  return { bookingId: b.id, userId: u.id, gapAfterFunding: g };
}

/** Cancels with the detached refund suppressed: the state a crash between the two leaves behind. */
async function cancelledUnrefunded(price: number) {
  const f = await paidBooking(price);
  const svc = bookingRefundService as unknown as { processCancellationRefund: (...a: unknown[]) => Promise<unknown> };
  const orig = svc.processCancellationRefund;
  svc.processCancellationRefund = () => new Promise(() => {});
  try {
    await bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN}`);
  } finally {
    svc.processCancellationRefund = orig;
  }
  return f;
}

async function waitRefundSettled(bookingId: string, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") break;
    await sleep(100);
  }
  await sleep(300);
}

/** Every per-booking invariant the mandate lists. */
async function verify(caseId: string, bookingId: string, userId: string, expectPaise: number, gapAfterFunding: number, extra = "") {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true, walletBalancePaise: true } });
  const refunds = (await prisma.$queryRawUnsafe(
    `SELECT id, amount_paise::bigint p, idempotency_key k, reference_type rt FROM wallet_transactions
      WHERE reference_id=$1 AND user_id=$2 AND type::text='REFUND' AND status::text='COMPLETED'`, bookingId, userId)) as Array<{ id: string; p: bigint; k: string; rt: string }>;
  const refundPaise = refunds.reduce((s, r) => s + Number(r.p), 0);
  const journalKeys = refunds.map((r) =>
    r.rt === "booking_cancel_refund" ? `wallet_booking_refund:${bookingId}` : `wallet_admin_refund:${r.k.replace("wallet-admin-refund:", "admin-refund:")}`);
  const journals = (await prisma.$queryRawUnsafe(
    `SELECT j.idempotency_key k, sum(l.debit_paise)::bigint dr, sum(l.credit_paise)::bigint cr,
            sum(l.debit_paise) FILTER (WHERE a.code='PLATFORM_ESCROW')::bigint esc_dr, sum(l.credit_paise) FILTER (WHERE a.code='CUSTOMER_WALLET')::bigint cw_cr
       FROM journal_entries j JOIN ledger_entries l ON l.journal_id=j.id JOIN ledger_accounts a ON a.id=l.account_id
      WHERE j.reference_id=$1 AND j.type::text='REFUND' GROUP BY j.idempotency_key`, bookingId)) as Array<{ k: string; dr: bigint; cr: bigint; esc_dr: bigint; cw_cr: bigint }>;
  const journalPaise = journals.reduce((s, j) => s + Number(j.cw_cr ?? 0n), 0);
  const balanced = journals.every((j) => j.dr === j.cr && j.esc_dr === j.cw_cr);
  const keysMatch = journalKeys.every((k) => journals.some((j) => j.k === k)) && journals.length === refunds.length;
  const payRows = await prisma.payment.count({ where: { bookingId } });
  const rr = await prisma.refundRequest.count({ where: { idempotencyKey: { startsWith: `cancel-refund:${bookingId}` } } });
  const paid = Number(((await one(`SELECT coalesce(sum(amount_paise),0)::bigint p FROM wallet_transactions WHERE reference_id=$1 AND type::text='DEBIT' AND reference_type='booking_wallet_payment' AND status::text='COMPLETED'`, bookingId)).p) ?? 0);
  const g = await gap();
  const cancelRefund = refunds.find((r) => r.rt === "booking_cancel_refund");
  const expectBookingRefund = cancelRefund ? Number(cancelRefund.p) / 100 : 0;
  const bookingOk =
    String(b.status).startsWith("CANCELLED") &&
    (cancelRefund ? b.refundStatus === "processed" && Math.abs((b.refundAmount ?? 0) - expectBookingRefund) < 0.005 : true);
  const checks: Record<string, boolean> = {
    oneRefundPerKey: new Set(refunds.map((r) => r.k)).size === refunds.length,
    exactWallet: Number(u.walletBalancePaise) === expectPaise && Math.abs(u.walletBalance * 100 - expectPaise) < 0.5,
    exactRefundPaise: refundPaise === expectPaise,
    journalPerRefund: keysMatch,
    journalsBalanced: balanced,
    journalPaiseEqualsRefund: journalPaise === expectPaise,
    bookingState: bookingOk,
    paymentRepresentation: payRows === 0 && rr === 0 && b.paymentStatus === "SUCCESS" && b.paymentMethod === "wallet",
    noOverrun: refundPaise <= paid,
    noNegative: Number(u.walletBalancePaise) >= 0,
    noOpsLedgerDrift: Math.abs(g - gapAfterFunding) < 0.005,
  };
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  rec(caseId, bad.length === 0,
    `${bad.length ? `BROKEN ${bad.join(",")}; ` : ""}refunds ${refunds.length} (${refundPaise}p) expected ${expectPaise}p; wallet ${u.walletBalancePaise}p; ` +
      `journals ${journals.length} balanced=${balanced}; booking ${b.status}/${b.refundStatus}/${b.refundAmount}; payments ${payRows}, refund_requests ${rr}; ` +
      `gap ${gapAfterFunding}→${g}${extra ? `; ${extra}` : ""}`);
}

function child(mode: string, bookingId: string, userId: string, env: Record<string, string> = {}) {
  const p = spawn(process.execPath, [import.meta.path, "--child", mode, bookingId, userId], {
    env: { ...process.env, DATABASE_URL: dbUrl.replace(/application_name=[^&]*/, "") + (dbUrl.includes("?") ? "&" : "?") + `application_name=wrm-child-${mode}`, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
async function childSessionsGone(mode: string) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const n = (await one(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1`, `wrm-child-${mode}`)).n as number;
    if (n === 0) return Date.now() - t0;
    await sleep(250);
  }
  return -1;
}

const before = await wholeLedger();
console.log(`run ${RUN} db ${db} at ${new Date().toISOString()} pid ${process.pid}`);
console.log("LEDGER BEFORE", JSON.stringify(before));

// 1. full refund
{
  const f = await paidBooking(1000);
  const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
  const r = await bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN}`);
  await waitRefundSettled(f.bookingId);
  await verify("M1 full refund", f.bookingId, f.userId, 100_000, f.gapAfterFunding, `quote ${q?.refundAmount}/${q?.tier}; response ${JSON.stringify(r)}`);
}

// 2. partial refunds
{
  const f = await paidBooking(1000, 10); // standard tier: 10% fee
  const r = await bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN}`);
  await waitRefundSettled(f.bookingId);
  await verify("M2a policy partial (standard tier 90%)", f.bookingId, f.userId, 90_000, f.gapAfterFunding, `response ${JSON.stringify(r)}`);

  const g = await paidBooking(1000);
  const a1 = await bookingRefundService.processAdminRefund({ bookingId: g.bookingId, userId: g.userId, adminId: g.userId, amount: 300, reason: "WRM partial" });
  const q = await bookingRefundService.quoteForBooking(g.bookingId, "user");
  await bookingService.cancel({ userId: g.userId }, g.bookingId, `WRM ${RUN}`);
  await waitRefundSettled(g.bookingId);
  const over = await bookingRefundService.processAdminRefund({ bookingId: g.bookingId, userId: g.userId, adminId: `${g.userId}-2`, amount: 1, reason: "WRM over" });
  await verify("M2b admin partial 300 then cancel refunds remaining 700; further refund refused", g.bookingId, g.userId, 100_000, g.gapAfterFunding,
    `admin ${JSON.stringify(a1)}; quote after partial ${q?.refundAmount}; over-ceiling ${JSON.stringify(over)}`);
  if (!("error" in over) || over.error !== "AMOUNT_EXCEEDS_REFUNDABLE") rec("M2b-ceiling", false, JSON.stringify(over));
}

// 3. repeated same refund
{
  const f = await paidBooking(750);
  await bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN}`);
  await waitRefundSettled(f.bookingId);
  const again = [];
  for (let i = 0; i < 3; i++) {
    again.push(await bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "repeat", cancelledBy: "user", refundAmount: 750 }));
  }
  await verify("M3 repeated refund is a no-op", f.bookingId, f.userId, 75_000, f.gapAfterFunding, `repeats ${JSON.stringify(again)}`);
}

// 4. eight concurrent refund attempts
{
  const f = await cancelledUnrefunded(1200);
  const rs = await Promise.all(Array.from({ length: 8 }, () =>
    bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "x8", cancelledBy: "user", refundAmount: 1200 })));
  await prisma.booking.update({ where: { id: f.bookingId }, data: { refundStatus: "processed", refundAmount: 1200 } }); // what cancel's write-back does
  await verify("M4a 8 concurrent cancellation refunds → one credit", f.bookingId, f.userId, 120_000, f.gapAfterFunding,
    `statuses ${JSON.stringify(rs.map((r) => r.status))}`);
  // Losers of the race must report the winner's credit: cancel() writes the returned status onto the booking.
  rec("M4a-status every concurrent caller reports processed", rs.every((r) => r.status === "processed"), JSON.stringify(rs.map((r) => r.status)));

  const g = await paidBooking(1000);
  const admins = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    bookingRefundService.processAdminRefund({ bookingId: g.bookingId, userId: g.userId, adminId: `${g.userId}-a${i}`, amount: 200, reason: "x8 admin" })));
  const okN = admins.filter((a) => !("error" in a)).length;
  const refusedN = admins.filter((a) => "error" in a && a.error === "AMOUNT_EXCEEDS_REFUNDABLE").length;
  rec("M4b 8 concurrent different ₹200 admin refunds on ₹1000 → exactly 5 succeed, 3 refused by ceiling", okN === 5 && refusedN === 3,
    `ok ${okN}, refused ${refusedN}: ${JSON.stringify(admins.map((a) => ("error" in a ? a.error : a.status)))}`);
  await prisma.booking.update({ where: { id: g.bookingId }, data: { status: "CANCELLED_BY_USER", cancelledAt: new Date() } });
  await verify("M4b ledger", g.bookingId, g.userId, 100_000, g.gapAfterFunding);
}

// 5. refund after process crash — two seams
{
  const f = await paidBooking(900);
  const c = child("crash-before-refund", f.bookingId, f.userId);
  const armed = await waitFor(() => c.out().includes("CANCELLED"), 60_000);
  c.p.kill("SIGKILL");
  const gone = await childSessionsGone("crash-before-refund");
  const mid = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId }, select: { status: true, refundStatus: true, refundAmount: true } });
  const midRefunds = await prisma.walletTransaction.count({ where: { referenceId: f.bookingId, type: "REFUND" } });
  const sweep = await bookingRefundService.recoverStrandedCancellationRefunds(25, new Date(), 0);
  await verify("M5a crash after cancel commit, before refund → recovered by sweep", f.bookingId, f.userId, 90_000, f.gapAfterFunding,
    `armed ${armed}; after kill ${JSON.stringify(mid)} refunds ${midRefunds}; child sessions gone in ${gone}ms; sweep ${JSON.stringify(sweep)}`);
  if (!(armed && mid.refundStatus === "pending" && midRefunds === 0)) rec("M5a-arm", false, `crash did not land at the seam: ${c.out().slice(0, 300)}`);

  const g = await paidBooking(900);
  const c2 = child("crash-inside-refund", g.bookingId, g.userId);
  const armed2 = await waitFor(() => c2.out().includes("IN_TX"), 60_000);
  c2.p.kill("SIGKILL");
  const gone2 = await childSessionsGone("crash-inside-refund");
  const mid2 = await prisma.booking.findUniqueOrThrow({ where: { id: g.bookingId }, select: { refundStatus: true } });
  const midRefunds2 = await prisma.walletTransaction.count({ where: { referenceId: g.bookingId, type: "REFUND" } });
  const midWallet2 = (await prisma.user.findUniqueOrThrow({ where: { id: g.userId }, select: { walletBalancePaise: true } })).walletBalancePaise;
  const sweep2 = await bookingRefundService.recoverStrandedCancellationRefunds(25, new Date(), 0);
  await verify("M5b crash inside the uncommitted refund transaction → rolled back, then recovered once", g.bookingId, g.userId, 90_000, g.gapAfterFunding,
    `armed ${armed2}; after kill refundStatus ${mid2.refundStatus}, refunds ${midRefunds2}, wallet ${midWallet2}p; sessions gone in ${gone2}ms; sweep ${JSON.stringify(sweep2)}`);
  if (!(armed2 && midRefunds2 === 0 && midWallet2 === 0n)) rec("M5b-arm", false, `crash did not land inside the tx: ${c2.out().slice(0, 300)}`);
}

// 6. retry after an ambiguous response
{
  const f = await cancelledUnrefunded(640);
  const inflight = bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "ambiguous", cancelledBy: "user", refundAmount: 640 });
  const first = await Promise.race([inflight, sleep(1).then(() => "NO_RESPONSE")]);
  const retry = await bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "ambiguous retry", cancelledBy: "user", refundAmount: 640 });
  const late = await inflight;
  await prisma.booking.update({ where: { id: f.bookingId }, data: { refundStatus: "processed", refundAmount: 640 } });
  await verify("M6a cancellation refund retried after no response", f.bookingId, f.userId, 64_000, f.gapAfterFunding,
    `first ${JSON.stringify(first)}; retry ${JSON.stringify(retry)}; original ${JSON.stringify(late)}`);

  const g = await paidBooking(500);
  const args = { bookingId: g.bookingId, userId: g.userId, adminId: g.userId, amount: 200, reason: "ambiguous admin" };
  const a = bookingRefundService.processAdminRefund(args);
  const b = await bookingRefundService.processAdminRefund(args);
  const a2 = await a;
  await prisma.booking.update({ where: { id: g.bookingId }, data: { status: "CANCELLED_BY_USER", cancelledAt: new Date() } });
  await verify("M6b identical admin refund resubmitted → one credit", g.bookingId, g.userId, 20_000, g.gapAfterFunding, `${JSON.stringify(a2)} / ${JSON.stringify(b)}`);
}

// 7. outbox redelivery of the cancellation event
{
  const { bootstrapEventConsumers } = await import("../../src/events/consumers/index");
  const { processOutboxBatch } = await import("../../src/events/core/outbox-processor");
  const { replayOutboxEvent } = await import("../../src/events/core/replay");
  bootstrapEventConsumers();
  const f = await paidBooking(1100);
  await bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN}`);
  await waitRefundSettled(f.bookingId);
  const ev = (await prisma.eventOutbox.findFirst({ where: { aggregateId: f.bookingId, eventType: "homigo.booking.cancelled" }, select: { eventId: true } }));
  let delivered = 0;
  for (let i = 0; i < 10; i++) delivered += (await processOutboxBatch()).claimed;
  const replays = ev ? [await replayOutboxEvent({ eventId: ev.eventId, force: true }), await replayOutboxEvent({ eventId: ev.eventId, force: true })] : [];
  await verify("M7 cancellation event delivered then force-replayed twice → money unchanged", f.bookingId, f.userId, 110_000, f.gapAfterFunding,
    `event ${ev ? "present" : "ABSENT (outbox disabled?)"}; claimed ${delivered}; replays ${JSON.stringify(replays.map((r) => r.reason))}`);
}

// 8. scheduler / reconciliation racing the detached refund
{
  const f = await cancelledUnrefunded(830);
  const racers = await Promise.all([
    ...Array.from({ length: 4 }, () => bookingRefundService.recoverStrandedCancellationRefunds(25, new Date(), 0)),
    ...Array.from({ length: 3 }, () => bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "race", cancelledBy: "user", refundAmount: 830 })),
    bookingRefundService.retryFailedRefunds(25),
  ]);
  await prisma.booking.updateMany({ where: { id: f.bookingId, refundStatus: "pending" }, data: { refundStatus: "processed", refundAmount: 830 } });
  const post = await bookingRefundService.recoverStrandedCancellationRefunds(25, new Date(), 0);
  await verify("M8 4 sweeps + 3 detached refunds + refund-retry scan racing → one credit", f.bookingId, f.userId, 83_000, f.gapAfterFunding,
    `racers ${JSON.stringify(racers).slice(0, 300)}; sweep afterwards ${JSON.stringify(post)}`);
}

// 9. Redis unavailable (the whole cancellation runs in a process whose Redis is a dead port)
{
  const f = await paidBooking(990);
  const c = child("redis-down", f.bookingId, f.userId, { REDIS_URL: "redis://127.0.0.1:6399" });
  await waitFor(() => c.out().includes("DONE"), 90_000);
  c.p.kill("SIGKILL");
  await childSessionsGone("redis-down");
  await verify("M9 Redis unavailable", f.bookingId, f.userId, 99_000, f.gapAfterFunding, c.out().split("\n").find((l) => l.startsWith("CANCELLED"))?.slice(0, 200) ?? `child: ${c.out().slice(-300)}`);
}

// 10. notification failure after the refund commits
{
  const ns = notificationService as unknown as Record<string, unknown>;
  const saved = { a: ns.createForUserDetached, b: ns.notifyBookingCancelled, c: ns.createForUser };
  let thrown = 0;
  const boom = () => { thrown++; throw new Error("WRM notification outage"); };
  ns.createForUserDetached = boom; ns.notifyBookingCancelled = boom; ns.createForUser = boom;
  const f = await paidBooking(610);
  let cancelRes: unknown;
  try {
    cancelRes = await bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN}`);
    await waitRefundSettled(f.bookingId);
  } finally {
    ns.createForUserDetached = saved.a; ns.notifyBookingCancelled = saved.b; ns.createForUser = saved.c;
  }
  await verify("M10 notification failure after refund commit", f.bookingId, f.userId, 61_000, f.gapAfterFunding, `notification calls thrown ${thrown}; cancel ${JSON.stringify(cancelRes)}`);
}

// 11. realtime failure after the refund commits
{
  const rm = roomManager as unknown as Record<string, unknown>;
  const saved = { b: rm.broadcast, s: rm.sendToUser };
  let thrown = 0;
  rm.broadcast = () => { thrown++; throw new Error("WRM realtime outage"); };
  rm.sendToUser = () => { thrown++; throw new Error("WRM realtime outage"); };
  const f = await paidBooking(470);
  let cancelRes: unknown;
  try {
    cancelRes = await bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN}`);
    await waitRefundSettled(f.bookingId);
  } finally {
    rm.broadcast = saved.b; rm.sendToUser = saved.s;
  }
  await verify("M11 realtime failure after refund commit", f.bookingId, f.userId, 47_000, f.gapAfterFunding, `realtime calls thrown ${thrown}; cancel ${JSON.stringify(cancelRes)}`);
}

// 12. customer retries the cancellation after no response (8 concurrent + 1 late)
{
  const f = await paidBooking(1300);
  const rs = await Promise.all(Array.from({ length: 8 }, () => bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN}`)));
  await waitRefundSettled(f.bookingId);
  const late = await bookingService.cancel({ userId: f.userId }, f.bookingId, `WRM ${RUN} late`);
  const wins = rs.filter((r) => "status" in r).length;
  await verify("M12 customer cancel retried ×8 concurrently + late retry → one cancel, one refund", f.bookingId, f.userId, 130_000, f.gapAfterFunding,
    `winners ${wins}, others ${JSON.stringify(rs.filter((r) => !("status" in r)).map((r) => (r as { error: string }).error))}; late ${JSON.stringify(late)}`);
  if (wins !== 1) rec("M12-winners", false, `winners ${wins}`);
}

// wait for detached work (cashback reversal, audit, notifications) before the whole-ledger read
await sleep(3000);
{
  // Deliver every event this run emitted so the environment is left with nothing undelivered.
  const { processOutboxBatch } = await import("../../src/events/core/outbox-processor");
  for (let i = 0; i < 20; i++) {
    const n = (await one(`SELECT count(*)::int n FROM event_outbox WHERE status IN ('PENDING','PROCESSING')`)).n as number;
    if (n === 0) break;
    await processOutboxBatch();
    await sleep(250);
  }
}
const after = await wholeLedger();
console.log("LEDGER AFTER", JSON.stringify(after));
const integ = await financialIntegrityService.validate().catch((e: Error) => ({ error: e.message }));
console.log("PRODUCT INTEGRITY validate()", JSON.stringify(integ).slice(0, 1200));
const gapBefore = Math.round((before.customerWalletOps - before.customerWalletLedger) * 100) / 100;
const gapAfter = Math.round((after.customerWalletOps - after.customerWalletLedger) * 100) / 100;
console.log(`CUSTOMER_WALLET ops-vs-ledger gap ${gapBefore} → ${gapAfter}; tracked fixture funding ${fixtureFundingRupees} (drift beyond funding: ${Math.round((gapAfter - gapBefore - fixtureFundingRupees) * 100) / 100})`);
rec("W whole-ledger", after.unbalanced === 0 && after.orphanLines === 0 && after.negativeWallets === 0 && after.userPaiseMismatch === 0 && after.txnPaiseMismatch === 0 &&
  after.dupJournalKeys === 0 && after.dupWalletKeys === 0 && after.paymentRefundOverrun === 0 && after.walletRefundOverrun === before.walletRefundOverrun &&
  after.debit_paise === after.credit_paise && Math.abs(gapAfter - gapBefore - fixtureFundingRupees) < 0.005,
  `unbalanced ${after.unbalanced}, orphans ${after.orphanLines}, negative ${after.negativeWallets}, paise ${after.userPaiseMismatch}/${after.txnPaiseMismatch}, dup keys ${after.dupJournalKeys}/${after.dupWalletKeys}, overrun ${after.paymentRefundOverrun}/${after.walletRefundOverrun} (wallet overrun before ${before.walletRefundOverrun}: break-the-fix artifacts), dr=cr ${after.debit_paise === after.credit_paise}, payments ${before.payments}→${after.payments}, refund_requests ${before.refundRequests}→${after.refundRequests}`);
const leftover = (await one(`SELECT count(*)::int n FROM event_outbox WHERE status IN ('PENDING','PROCESSING')`)).n;
console.log(`egress attempts refused: ${egressAttempts.length} ${JSON.stringify([...new Set(egressAttempts)])}; outbox undelivered ${leftover}`);
const fails = results.filter((r) => !r.ok);
console.log(`\nMATRIX ${RUN}: ${results.length - fails.length} PASS / ${fails.length} FAIL`);
await prisma.$disconnect();
process.exit(fails.length ? 1 : 0);
