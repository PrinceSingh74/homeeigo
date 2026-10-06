/**
 * D1 (split wallet + gateway refund) + D2 (crash-safe gateway refund) — verification matrix.
 * homigo_test ONLY. No real gateway: NODE_ENV=test makes load-env apply .env.test (empty Razorpay keys),
 * so the product's own dev gateway path runs; the script refuses to start unless that is proven.
 *
 * Provider fixture (test-only, this process and its children): for the cases whose subject IS the
 * provider's state — a refund the gateway holds but we never recorded — the two provider-boundary
 * methods `executeGatewayRefund` / `fetchRefundsForPayment` are replaced by a file-backed stand-in that
 * follows Razorpay's documented contract: refunds are listed per payment with notes.homigo_operation,
 * and a reused X-Refund-Idempotency key is answered 409 (ALREADY_SUBMITTED). The stateless dev path
 * cannot answer "does this refund already exist", which is exactly the question recovery must ask.
 * Every other case runs on the unmodified dev path.
 *
 *   NODE_ENV=test REDIS_URL=redis://localhost:6380 HTTPS_PROXY=http://127.0.0.1:9 ... \
 *     bun scripts/chaos/refund-d1d2-matrix.ts <tag> [--reverse]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { directInsertLiveFlags } from "../../src/lib/catalog-governance";

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
const { paymentService } = await import("../../src/services/payment.service");
const { bookingService } = await import("../../src/services/booking.service");
const { bookingRefundService, allocateSplitRefund } = await import("../../src/services/booking-refund.service");
const { refundOrchestratorService } = await import("../../src/services/refund-orchestrator.service");
const { financialIntegrityService } = await import("../../src/services/financial-integrity.service");
const { notificationService } = await import("../../src/services/notification.service");
const { roomManager } = await import("../../src/lib/websocket");

const db = ((await prisma.$queryRawUnsafe(`SELECT current_database() AS d`)) as Array<{ d: string }>)[0]?.d;
if (db !== "homigo_test" || razorpayService.isConfigured || !/:6380\b|:6399\b/.test(process.env.REDIS_URL ?? "") || process.env.HTTPS_PROXY !== "http://127.0.0.1:9") {
  console.error(`REFUSED: db=${db} gatewayConfigured=${razorpayService.isConfigured} redis=${process.env.REDIS_URL} proxy=${process.env.HTTPS_PROXY}`);
  process.exit(2);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── provider fixture (file-backed so a killed child's gateway-side effects survive it) ──────────────
type FxRefund = { id: string; payment_id: string; amount: number; status: string; notes: Record<string, string> };
type FxStore = { refunds: FxRefund[]; keys: Record<string, string>; modes: Record<string, string>; calls: Record<string, number> };
const FX_PATH = process.env.FX_STORE ?? `D:/tmp/refund-fx-${Date.now().toString(36)}.json`;
const fxLoad = (): FxStore => (existsSync(FX_PATH) ? JSON.parse(readFileSync(FX_PATH, "utf8")) : { refunds: [], keys: {}, modes: {}, calls: {} });
const fxSave = (s: FxStore) => writeFileSync(FX_PATH, JSON.stringify(s));
let fxOn = process.env.FX_ON === "1";
const devExecute = razorpayService.executeGatewayRefund.bind(razorpayService);
const devFetch = razorpayService.fetchRefundsForPayment.bind(razorpayService);
(razorpayService as unknown as Record<string, unknown>).executeGatewayRefund = async (o: { paymentId: string; amountInr: number; operationKey?: string }) => {
  if (!fxOn) return devExecute(o);
  const st = fxLoad();
  st.calls[o.paymentId] = (st.calls[o.paymentId] ?? 0) + 1;
  if (o.operationKey && st.keys[o.operationKey]) {
    fxSave(st);
    return { kind: "ALREADY_SUBMITTED", detail: "409: idempotency key already used" };
  }
  const mode = st.modes[o.paymentId] ?? "normal";
  if (mode !== "normal") st.modes[o.paymentId] = "normal"; // one-shot fault
  if (mode === "timeout_not_sent") { fxSave(st); return { kind: "INDETERMINATE", reason: "ETIMEDOUT", detail: "fixture: request never reached the gateway" }; }
  if (mode === "hang_before") { fxSave(st); console.log("IN_GATEWAY"); await new Promise(() => {}); }
  const refund: FxRefund = { id: `rfnd_fx_${Math.random().toString(36).slice(2, 12)}`, payment_id: o.paymentId, amount: Math.round(o.amountInr * 100), status: "processed", notes: o.operationKey ? { homigo_operation: o.operationKey } : {} };
  st.refunds.push(refund);
  if (o.operationKey) st.keys[o.operationKey] = refund.id;
  fxSave(st);
  if (mode === "lost_response") return { kind: "INDETERMINATE", reason: "ECONNRESET", detail: "fixture: refund created, response lost" };
  if (mode === "hang_after") { console.log("IN_GATEWAY"); await new Promise(() => {}); }
  return { kind: "SUCCESS", refundId: refund.id, status: "processed" };
};
(razorpayService as unknown as Record<string, unknown>).fetchRefundsForPayment = async (pid: string) => (fxOn ? fxLoad().refunds.filter((r) => r.payment_id === pid) : devFetch(pid));

// ── child modes: the process that dies ─────────────────────────────────────────────────────────────
if (process.argv[2] === "--child") {
  const [, , , mode, bookingId, userId] = process.argv;
  if (mode === "crash-before-refund") {
    (bookingRefundService as unknown as Record<string, unknown>).processCancellationRefund = () => new Promise(() => {});
  }
  if (mode === "crash-in-plan") {
    // Inside the refund's own transaction, after its reservation (and, for a split, its wallet credit).
    const orig = refundOrchestratorService.reserveInTx.bind(refundOrchestratorService);
    (refundOrchestratorService as unknown as Record<string, unknown>).reserveInTx = async (tx: unknown, o: unknown) => {
      await orig(tx as never, o as never);
      console.log("IN_PLAN");
      await new Promise(() => {});
    };
  }
  const r = await bookingService.cancel({ userId: userId! }, bookingId!, `D12 ${mode}`);
  console.log(`CANCELLED ${JSON.stringify(r)}`);
  if (mode === "redis-down") { await sleep(4000); console.log("DONE"); process.exit(0); }
  await new Promise(() => {});
}

// ── parent ─────────────────────────────────────────────────────────────────────────────────────────
const TAG = process.argv[2] ?? "p";
const REVERSE = process.argv.includes("--reverse");
const RUN = `D12-${TAG}-${Date.now().toString(36)}`;
const one = async (sql: string, ...a: unknown[]) => ((await prisma.$queryRawUnsafe(sql, ...a)) as Array<Record<string, unknown>>)[0] ?? {};
const gap = async () => {
  const r = await one(`SELECT (SELECT coalesce(sum(wallet_balance),0)::float FROM users) ops,
    (SELECT coalesce(sum(l.credit-l.debit),0)::float FROM ledger_entries l JOIN ledger_accounts a ON a.id=l.account_id WHERE a.code='CUSTOMER_WALLET') led`);
  return Math.round(((r.ops as number) - (r.led as number)) * 100) / 100;
};
const ledger = async () => one(`SELECT
  (SELECT count(*)::int FROM (SELECT journal_id FROM ledger_entries GROUP BY 1 HAVING sum(debit_paise)<>sum(credit_paise)) x) unbalanced,
  (SELECT (sum(debit_paise)=sum(credit_paise)) FROM ledger_entries) dr_eq_cr,
  (SELECT count(*)::int FROM (SELECT idempotency_key FROM journal_entries WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*)>1) x) dup_journal_keys,
  (SELECT count(*)::int FROM (SELECT idempotency_key FROM wallet_transactions WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*)>1) x) dup_wallet_keys,
  (SELECT count(*)::int FROM users WHERE wallet_balance_paise < 0) negative,
  (SELECT count(*)::int FROM payments WHERE refunded_amount > amount + 0.01) payment_overrun`);

const service = await prisma.service.create({
  data: { ...directInsertLiveFlags("refund-d1d2-matrix"), name: `D12 ${RUN}`, slug: `d12-${RUN}`.toLowerCase(), description: "d1d2 matrix", category: "cleaning", basePrice: 1000, estimatedDuration: 60 },
});
let seq = 0;
type Fx = { bookingId: string; userId: string; paymentId: string | null; gatewayRef: string | null; total: number; walletShare: number; gap0: number; kind: "split" | "gateway" };

async function newUser(walletFunding: number) {
  seq++;
  const u = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION", email: `${RUN.toLowerCase()}-${seq}@d12.test`, phoneNumber: `+9174${String(Date.now() + seq).slice(-8)}`, firstName: "D12", lastName: `C${seq}`,
      password: "x".repeat(20), role: "CUSTOMER", isEmailVerified: true, isPhoneVerified: true, walletBalance: 0 },
  });
  if (walletFunding > 0) {
    const t = await walletService.addMoney(u.id, walletFunding);
    if ("error" in t) throw new Error(t.error);
    await walletService.verifyTopUp(u.id, { razorpayOrderId: t.razorpayOrderId, razorpayPaymentId: `pay_dev_${RUN}_${seq}_t`, razorpaySignature: "dev_unsigned" });
  }
  const a = await prisma.address.create({ data: { userId: u.id, label: "H", addressLine1: "1 D12 St", city: "Noida", state: "UP", zipCode: "201301", latitude: 28.62, longitude: 77.37 } });
  return { u, a };
}
async function newBooking(userId: string, addressId: string, total: number, hoursAhead: number) {
  return prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION", bookingNumber: `${RUN}-${seq}`, userId, serviceId: service.id, addressId, status: "PENDING",
      scheduledDate: new Date(Date.now() + hoursAhead * 3_600_000), baseAmount: total, finalAmount: total, totalAmount: total, paymentStatus: "PENDING", description: `D12 ${RUN}` },
  });
}
/** Real split checkout: initiateSplit → verifySplit (dev order, dev signature under paymentMocksAllowed). */
async function splitPaid(total = 1000, walletShare = 400, hoursAhead = 72): Promise<Fx> {
  const { u, a } = await newUser(walletShare);
  const b = await newBooking(u.id, a.id, total, hoursAhead);
  const init = await walletCheckoutService.initiateSplit(u.id, b.id, walletShare);
  if (!("mode" in init) || init.mode !== "split") throw new Error(`initiate ${JSON.stringify(init)}`);
  const pid = `pay_dev_${RUN}_${seq}`;
  const v = await walletCheckoutService.verifySplit(u.id, { razorpayOrderId: init.razorpayOrderId, razorpayPaymentId: pid, razorpaySignature: razorpayService.computePaymentSignature(init.razorpayOrderId, pid) });
  if (!("ok" in v)) throw new Error(`verify ${JSON.stringify(v)}`);
  const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
  return { bookingId: b.id, userId: u.id, paymentId: p.id, gatewayRef: pid, total, walletShare, gap0: await gap(), kind: "split" };
}
/** Real gateway checkout: paymentService.createOrder → paymentService.verify (dev order). */
async function gatewayPaid(total = 1000, hoursAhead = 72): Promise<Fx> {
  const { u, a } = await newUser(0);
  const b = await newBooking(u.id, a.id, total, hoursAhead);
  const order = (await paymentService.createOrder(u.id, b.id)) as { razorpayOrderId?: string };
  if (!order?.razorpayOrderId) throw new Error(`createOrder ${JSON.stringify(order)}`);
  const pid = `pay_dev_${RUN}_${seq}`;
  const v = await paymentService.verify(u.id, { razorpayOrderId: order.razorpayOrderId, razorpayPaymentId: pid, razorpaySignature: razorpayService.computePaymentSignature(order.razorpayOrderId, pid) });
  if (v && typeof v === "object" && "error" in v) throw new Error(`verify ${JSON.stringify(v)}`);
  const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
  if (p.status !== "SUCCESS") throw new Error(`gateway payment not SUCCESS: ${p.status}`);
  return { bookingId: b.id, userId: u.id, paymentId: p.id, gatewayRef: pid, total, walletShare: 0, gap0: await gap(), kind: "gateway" };
}
const paid = (kind: "split" | "gateway", hoursAhead = 72) => (kind === "split" ? splitPaid(1000, 400, hoursAhead) : gatewayPaid(1000, hoursAhead));
const fullExp = (f: Fx) => ({ gw: Math.round((f.total - f.walletShare) * 100), w: Math.round(f.walletShare * 100) });

async function cancelSuppressed(f: Fx) {
  const svc = bookingRefundService as unknown as Record<string, unknown>;
  const orig = svc.processCancellationRefund;
  svc.processCancellationRefund = () => new Promise(() => {});
  try { await bookingService.cancel({ userId: f.userId }, f.bookingId, `D12 ${RUN}`); } finally { svc.processCancellationRefund = orig; }
}
async function settle(bookingId: string) {
  for (let i = 0; i < 80; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") break;
    await sleep(100);
  }
  await sleep(400);
}
async function recover(times = 1) {
  const out = [];
  for (let i = 0; i < times; i++) {
    out.push({
      stale: await bookingRefundService.recoverStaleGatewayRefunds(100, new Date(), 0),
      retry: await bookingRefundService.retryFailedRefunds(100),
      stranded: await bookingRefundService.recoverStrandedCancellationRefunds(100, new Date(), 0),
    });
  }
  return out;
}

const results: Array<{ id: string; ok: boolean; detail: string }> = [];
function rec(id: string, ok: boolean, detail: string) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
}

/** Every invariant the mandate lists, for one booking. */
async function verify(id: string, f: Fx, exp: { gw: number; w: number }, o: { expectRefundStatus?: string[]; note?: unknown; checkBooking?: boolean } = {}) {
  const pay = f.paymentId ? await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } }) : null;
  const reqs = f.paymentId ? await prisma.refundRequest.findMany({ where: { paymentId: f.paymentId } }) : [];
  const done = reqs.filter((r) => r.status === "COMPLETED");
  const gwDonePaise = done.reduce((s, r) => s + Math.round(r.amount * 100), 0);
  const nonTerminal = reqs.filter((r) => ["REFUNDING", "INDETERMINATE", "PROCESSING"].includes(r.status)).length;
  const gwJournals = done.length
    ? ((await one(`SELECT count(*)::int n, coalesce(bool_and(ok),true) balanced FROM (SELECT j.id, sum(l.debit_paise)=sum(l.credit_paise) ok FROM journal_entries j JOIN ledger_entries l ON l.journal_id=j.id WHERE j.idempotency_key = ANY($1::text[]) GROUP BY j.id) x`,
        done.map((r) => `refund:${r.gatewayRefundId}`))) as { n: number; balanced: boolean })
    : { n: 0, balanced: true };
  const wRefunds = (await prisma.$queryRawUnsafe(`SELECT idempotency_key k, amount_paise::bigint p, reference_type rt FROM wallet_transactions WHERE reference_id=$1 AND user_id=$2 AND type::text='REFUND' AND status::text='COMPLETED'`, f.bookingId, f.userId)) as Array<{ k: string; p: bigint; rt: string }>;
  const wPaise = wRefunds.reduce((s, r) => s + Number(r.p), 0);
  const wJournalKeys = wRefunds.map((r) => (r.rt === "booking_cancel_refund" ? `wallet_booking_refund:${f.bookingId}` : `wallet_admin_refund:${r.k.replace("wallet-admin-refund:", "admin-refund:")}`));
  const wJournals = (await one(`SELECT count(*)::int n, coalesce(bool_and(ok),true) balanced, coalesce(sum(cw),0)::bigint cw FROM (
      SELECT j.id, sum(l.debit_paise)=sum(l.credit_paise) ok, sum(l.credit_paise) FILTER (WHERE a.code='CUSTOMER_WALLET') cw
        FROM journal_entries j JOIN ledger_entries l ON l.journal_id=j.id JOIN ledger_accounts a ON a.id=l.account_id
       WHERE j.idempotency_key = ANY($1::text[]) GROUP BY j.id) x`, wJournalKeys)) as { n: number; balanced: boolean; cw: bigint };
  const provider = fxOn || fxLoad().refunds.some((r) => r.payment_id === f.gatewayRef) ? fxLoad().refunds.filter((r) => r.payment_id === f.gatewayRef) : null;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: f.userId }, select: { walletBalancePaise: true } });
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
  const g = await gap();
  const paidPaise = Math.round(f.total * 100);
  const expectStatus = o.expectRefundStatus ?? ["processed", "processing"];
  const checks: Record<string, boolean> = {
    exactGateway: gwDonePaise === exp.gw && (pay ? Math.round((pay.refundedAmount ?? 0) * 100) === exp.gw : true),
    exactWallet: wPaise === exp.w && Number(user.walletBalancePaise) === exp.w,
    totalWithinPaid: gwDonePaise + wPaise <= paidPaise,
    oneJournalPerGatewayRefund: gwJournals.n === done.length && gwJournals.balanced,
    oneJournalPerWalletRefund: Number(wJournals.n) === wRefunds.length && wJournals.balanced && Number(wJournals.cw) === wPaise,
    noDuplicateWalletCredit: new Set(wRefunds.map((r) => r.k)).size === wRefunds.length,
    providerMatchesLocal: provider === null ? true : provider.length === done.length && provider.reduce((s, r) => s + r.amount, 0) === gwDonePaise,
    converged: nonTerminal === 0 && (pay ? pay.status !== "REFUNDING" : true),
    bookingState: o.checkBooking === false ? true : expectStatus.includes(String(b.refundStatus)),
    noWalletDrift: Math.abs(g - f.gap0) < 0.005,
    noNegative: Number(user.walletBalancePaise) >= 0,
  };
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  rec(id, bad.length === 0,
    `${bad.length ? `BROKEN ${bad.join(",")}; ` : ""}gateway ${gwDonePaise}p/${exp.gw}p (requests ${reqs.map((r) => r.status).join("|") || "none"}${provider ? `, provider ${provider.length}` : ""}); wallet ${wPaise}p/${exp.w}p; ` +
      `journals gw ${gwJournals.n} wallet ${wJournals.n}; payment ${pay?.status ?? "-"}; booking ${b.status}/${b.refundStatus}/${b.refundAmount}; gap ${f.gap0}→${g}` +
      (o.note !== undefined ? `; ${JSON.stringify(o.note).slice(0, 400)}` : ""));
}

function child(mode: string, f: Fx, env: Record<string, string> = {}) {
  const p = spawn(process.execPath, [import.meta.path, "--child", mode, f.bookingId, f.userId], {
    env: { ...process.env, FX_STORE: FX_PATH, FX_ON: fxOn ? "1" : "0", ...env }, stdio: ["ignore", "pipe", "pipe"],
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
function setMode(f: Fx, mode: string) {
  const st = fxLoad();
  st.modes[f.gatewayRef!] = mode;
  fxSave(st);
}
const ordered = <T>(xs: T[]) => (REVERSE ? [...xs].reverse() : xs);

// ── cases ──────────────────────────────────────────────────────────────────────────────────────────
type Case = { id: string; run: () => Promise<void> };
const cases: Case[] = [];
const add = (id: string, run: () => Promise<void>) => cases.push({ id, run });

// D1 — split refund as two legs
add("D1.1 full split refund (free tier) ₹400 wallet + ₹600 gateway", async () => {
  const f = await splitPaid();
  const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
  const r = await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12");
  await settle(f.bookingId);
  await verify("D1.1 full split refund", f, fullExp(f), { note: { quote: q?.refundAmount, response: (r as { refundAmount?: number }).refundAmount } });
  if (q?.refundAmount !== 1000 || (r as { refundAmount?: number }).refundAmount !== 1000) rec("D1.1-quote", false, `quote ${q?.refundAmount} response ${(r as { refundAmount?: number }).refundAmount}`);
});
add("D1.2 policy partial (standard tier 90%) → ₹900 = ₹540 gateway + ₹360 wallet", async () => {
  const f = await splitPaid(1000, 400, 10);
  const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
  await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12");
  await settle(f.bookingId);
  await verify("D1.2 policy partial", f, { gw: 54_000, w: 36_000 }, { note: { quote: q?.refundAmount } });
});
add("D1.3 admin ₹500 → ₹300+₹200; quote then ₹500; cancel refunds the rest; ₹1 more refused", async () => {
  const f = await splitPaid();
  const a = await bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: f.userId, amount: 500, reason: "D12 admin" });
  const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
  await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12");
  await settle(f.bookingId);
  const over = await bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: `${f.userId}-x`, amount: 1, reason: "D12 over" });
  await verify("D1.3 admin partial then cancel", f, fullExp(f), { note: { admin: a, quoteAfterAdmin: q?.refundAmount, over } });
  const ok = !("error" in a) && q?.refundAmount === 500 && "error" in over && over.error === "AMOUNT_EXCEEDS_REFUNDABLE";
  rec("D1.3-contract admin split exact, quote=remaining, ceiling holds", ok, JSON.stringify({ a, quote: q?.refundAmount, over }));
});
add("D1.4 paise rounding: ₹999.99 paid ₹333.33 wallet; admin ₹100.01 splits exactly", async () => {
  const f = await splitPaid(999.99, 333.33);
  const a = await bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: f.userId, amount: 100.01, reason: "D12 rounding" });
  // Independent expectation: gateway = floor(10001 × 66666 / 99999), wallet = remainder.
  const gw = (10001n * 66666n) / 99999n;
  const w = 10001n - gw;
  await prisma.booking.update({ where: { id: f.bookingId }, data: { status: "CANCELLED_BY_USER", cancelledAt: new Date() } });
  await verify("D1.4 rounding", f, { gw: Number(gw), w: Number(w) }, { checkBooking: false, note: { admin: a, expected: { gw: String(gw), w: String(w) } } });
  const unit = allocateSplitRefund(10001n, { gatewayPaise: 66666n, walletPaise: 33333n }, { gatewayPaise: 66666n, walletPaise: 33333n });
  rec("D1.4-unit allocation sums exactly and floors the gateway leg", !("error" in unit) && unit.gatewayPaise + unit.walletPaise === 10001n && unit.gatewayPaise === gw, JSON.stringify(unit, (_, v) => (typeof v === "bigint" ? String(v) : v)));
});
add("D1.5 non-proportional history (gateway-only ₹400 earlier) → cancel clamps legs, total exact", async () => {
  const f = await splitPaid();
  const legacy = await refundOrchestratorService.executeRefund({ paymentId: f.paymentId!, amount: 400, reason: "legacy gateway-only", actorUserId: f.userId, isAdmin: true, source: "admin", idempotencyKey: `legacy:${f.bookingId}` });
  await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12");
  await settle(f.bookingId);
  await verify("D1.5 clamp", f, fullExp(f), { note: { legacy: "error" in legacy ? legacy : { amount: legacy.amount } } });
});
for (const n of [2, 8]) {
  add(`D1.6-${n} ${n} concurrent cancellation refunds → one combined refund`, async () => {
    const f = await splitPaid();
    await cancelSuppressed(f);
    const calls = Array.from({ length: n }, () => () => bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "race", cancelledBy: "user", refundAmount: 1000 }));
    const rs = await Promise.all(ordered(calls).map((c) => c()));
    await prisma.booking.updateMany({ where: { id: f.bookingId }, data: { refundStatus: "processed" } });
    await verify(`D1.6-${n} concurrent ×${n}`, f, fullExp(f), { note: { statuses: rs.map((r) => r.status) } });
    rec(`D1.6-${n}-losers no caller fabricates a pending refund`, rs.every((r) => r.status === "processed" || r.status === "processing"), JSON.stringify(rs.map((r) => r.status)));
  });
}
add("D1.7 repeated cancellation (cancel ×3, refund ×3)", async () => {
  const f = await splitPaid();
  const cs = [];
  for (let i = 0; i < 3; i++) cs.push(await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12 repeat"));
  await settle(f.bookingId);
  const rs = [];
  for (let i = 0; i < 3; i++) rs.push((await bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "repeat", cancelledBy: "user", refundAmount: 1000 })).status);
  await verify("D1.7 repeated", f, fullExp(f), { note: { cancels: cs.map((c) => { const x = c as { status?: string; error?: string }; return x.error ?? x.status; }), refunds: rs } });
});
add("D1.8 admin ₹500 racing the cancellation → never more than paid", async () => {
  const f = await splitPaid();
  const tasks = [
    () => bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: f.userId, amount: 500, reason: "race admin" }),
    () => bookingService.cancel({ userId: f.userId }, f.bookingId, "D12 race"),
  ];
  const out = await Promise.all(ordered(tasks).map((t) => t()));
  await settle(f.bookingId);
  await recover(2); // the loser, if any, is finished or refused by the recovery paths
  const reqs = await prisma.refundRequest.findMany({ where: { paymentId: f.paymentId! } });
  const gw = reqs.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + Math.round(r.amount * 100), 0);
  const w = Number(((await one(`SELECT coalesce(sum(amount_paise),0)::bigint p FROM wallet_transactions WHERE reference_id=$1 AND type::text='REFUND' AND status::text='COMPLETED'`, f.bookingId)).p as bigint) ?? 0);
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
  rec("D1.8 admin racing cancel: total ≤ paid, legs ≤ ceilings, converged", gw + w <= 100_000 && gw <= 60_000 && w <= 40_000 && reqs.every((r) => !["REFUNDING", "INDETERMINATE"].includes(r.status)) && Math.abs((await gap()) - f.gap0) < 0.005,
    `gateway ${gw}p wallet ${w}p total ${gw + w}p; booking ${b.refundStatus}/${b.refundAmount}; outcomes ${JSON.stringify(out).slice(0, 300)}`);
});
add("D1.9 cancellation retry racing the detached refund and the sweep", async () => {
  const f = await splitPaid();
  const tasks = [
    () => bookingService.cancel({ userId: f.userId }, f.bookingId, "D12"),
    () => sleep(5).then(() => bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "retry", cancelledBy: "user", refundAmount: 1000 })),
    () => sleep(5).then(() => bookingRefundService.recoverStrandedCancellationRefunds(100, new Date(Date.now() + 120_000), 0)),
  ];
  await Promise.all(ordered(tasks).map((t) => t()));
  await settle(f.bookingId);
  await recover(1);
  await verify("D1.9 retry races detached", f, fullExp(f));
});
add("D1.10 ambiguous response + retry", async () => {
  const f = await splitPaid();
  await cancelSuppressed(f);
  const inflight = bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "amb", cancelledBy: "user", refundAmount: 1000 });
  const first = await Promise.race([inflight, sleep(1).then(() => "NO_RESPONSE")]);
  const retry = await bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "amb retry", cancelledBy: "user", refundAmount: 1000 });
  const late = await inflight;
  await prisma.booking.updateMany({ where: { id: f.bookingId }, data: { refundStatus: "processed" } });
  await verify("D1.10 ambiguous + retry", f, fullExp(f), { note: { first, retry: retry.status, original: late.status } });
});

// D2 — crash-safe gateway refund (gateway-only and split)
for (const kind of ["gateway", "split"] as const) {
  add(`D2.1-${kind} cancel commit → crash → restart (sweep)`, async () => {
    const f = await paid(kind);
    const c = child("crash-before-refund", f);
    const armed = await waitFor(() => c.out().includes("CANCELLED"), 60_000);
    c.p.kill("SIGKILL");
    await sleep(800);
    const mid = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId }, select: { refundStatus: true, refundAmount: true } });
    const midReq = f.paymentId ? await prisma.refundRequest.count({ where: { paymentId: f.paymentId } }) : 0;
    const r = await recover(1);
    await verify(`D2.1-${kind} crash before refund`, f, fullExp(f), { note: { armed, mid, midRequests: midReq, recovery: r } });
    if (!(armed && mid.refundStatus === "pending" && midReq === 0)) rec(`D2.1-${kind}-arm`, false, c.out().replace(/\s+/g, " ").slice(-700));
  });
  add(`D2.2-${kind} intent persisted → worker crash inside the refund transaction → recovery`, async () => {
    const f = await paid(kind);
    const c = child("crash-in-plan", f);
    const armed = await waitFor(() => c.out().includes("IN_PLAN"), 60_000);
    c.p.kill("SIGKILL");
    await sleep(1500);
    const midReq = await prisma.refundRequest.count({ where: { paymentId: f.paymentId! } });
    const midWallet = Number((await prisma.user.findUniqueOrThrow({ where: { id: f.userId }, select: { walletBalancePaise: true } })).walletBalancePaise);
    const r = await recover(1);
    await verify(`D2.2-${kind} crash in refund tx`, f, fullExp(f), { note: { armed, rolledBack: { requests: midReq, walletPaise: midWallet }, recovery: r } });
    if (!(armed && midReq === 0 && midWallet === 0)) rec(`D2.2-${kind}-atomic`, false, `after the kill: requests ${midReq}, wallet ${midWallet}p — both legs must roll back together`);
  });
  add(`D2.3-${kind} gateway timeout (never sent) → INDETERMINATE → reconcile → retry once`, async () => {
    fxOn = true;
    try {
      const f = await paid(kind);
      setMode(f, "timeout_not_sent");
      await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12");
      await settle(f.bookingId);
      const mid = (await prisma.refundRequest.findMany({ where: { paymentId: f.paymentId! } })).map((r) => r.status);
      const r = await recover(1);
      await verify(`D2.3-${kind} gateway timeout`, f, fullExp(f), { note: { mid, recovery: r } });
    } finally { fxOn = false; }
  });
  add(`D2.4-${kind} ambiguous response (refund made, answer lost) → reconcile CONFIRMS, no second refund`, async () => {
    fxOn = true;
    try {
      const f = await paid(kind);
      setMode(f, "lost_response");
      await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12");
      await settle(f.bookingId);
      const r = await recover(2);
      await verify(`D2.4-${kind} lost response`, f, fullExp(f), { note: { recovery: r, gatewayCalls: fxLoad().calls[f.gatewayRef!] } });
    } finally { fxOn = false; }
  });
  for (const when of ["hang_before", "hang_after"] as const) {
    add(`D2.5-${kind}-${when} crash during gateway call (${when === "hang_after" ? "gateway DID refund" : "gateway did NOT refund"}) → stale REFUNDING recovery`, async () => {
      fxOn = true;
      try {
        const f = await paid(kind);
        setMode(f, when);
        const c = child("gateway", f);
        const armed = await waitFor(() => c.out().includes("IN_GATEWAY"), 60_000);
        c.p.kill("SIGKILL");
        await sleep(1500);
        const mid = (await prisma.refundRequest.findMany({ where: { paymentId: f.paymentId! } })).map((r) => r.status);
        const r = await recover(1);
        const again = await recover(3); // D2.7 repeated retry: nothing more may happen
        await verify(`D2.5-${kind}-${when} crash during gateway call`, f, fullExp(f), { note: { armed, mid, recovery: r, repeated: again.map((x) => x.stale.scanned + x.retry.scanned + x.stranded.scanned), gatewayCalls: fxLoad().calls[f.gatewayRef!] } });
      } finally { fxOn = false; }
    });
  }
}
add("D2.8 four concurrent recovery workers on one stale REFUNDING refund", async () => {
  fxOn = true;
  try {
    const f = await gatewayPaid();
    setMode(f, "hang_after");
    const c = child("gateway", f);
    await waitFor(() => c.out().includes("IN_GATEWAY"), 60_000);
    c.p.kill("SIGKILL");
    await sleep(1500);
    const workers = await Promise.all(Array.from({ length: 4 }, () => bookingRefundService.recoverStaleGatewayRefunds(100, new Date(), 0)));
    await verify("D2.8 concurrent recovery workers", f, fullExp(f), { note: { workers } });
    rec("D2.8-claim exactly one worker settles it", workers.reduce((s, w) => s + w.confirmed, 0) === 1, JSON.stringify(workers));
  } finally { fxOn = false; }
});
for (const kind of ["gateway", "split"] as const) {
  add(`D2.9-${kind} outbox redelivery (event delivered + force-replayed ×2)`, async () => {
    const { bootstrapEventConsumers } = await import("../../src/events/consumers/index");
    const { processOutboxBatch } = await import("../../src/events/core/outbox-processor");
    const { replayOutboxEvent } = await import("../../src/events/core/replay");
    bootstrapEventConsumers();
    const f = await paid(kind);
    await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12");
    await settle(f.bookingId);
    for (let i = 0; i < 10; i++) await processOutboxBatch();
    const ev = await prisma.eventOutbox.findFirst({ where: { aggregateId: f.bookingId, eventType: "homigo.booking.cancelled" }, select: { eventId: true } });
    const rep = ev ? [await replayOutboxEvent({ eventId: ev.eventId, force: true }), await replayOutboxEvent({ eventId: ev.eventId, force: true })] : [];
    await verify(`D2.9-${kind} outbox redelivery`, f, fullExp(f), { note: { event: Boolean(ev), replays: rep.map((r) => r.reason) } });
  });
  add(`D2.10-${kind} notification failure`, async () => {
    const f = await paid(kind);
    const ns = notificationService as unknown as Record<string, unknown>;
    const saved = { a: ns.createForUserDetached, b: ns.notifyBookingCancelled };
    let thrown = 0;
    const boom = () => { thrown++; throw new Error("D12 notification outage"); };
    ns.createForUserDetached = boom; ns.notifyBookingCancelled = boom;
    try { await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12"); await settle(f.bookingId); } finally { ns.createForUserDetached = saved.a; ns.notifyBookingCancelled = saved.b; }
    await verify(`D2.10-${kind} notification failure`, f, fullExp(f), { note: { thrown } });
  });
  add(`D2.11-${kind} realtime failure`, async () => {
    const f = await paid(kind);
    const rm = roomManager as unknown as Record<string, unknown>;
    const saved = { b: rm.broadcast, s: rm.sendToUser };
    let thrown = 0;
    rm.broadcast = () => { thrown++; throw new Error("D12 realtime outage"); };
    rm.sendToUser = () => { thrown++; throw new Error("D12 realtime outage"); };
    try { await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12"); await settle(f.bookingId); } finally { rm.broadcast = saved.b; rm.sendToUser = saved.s; }
    await verify(`D2.11-${kind} realtime failure`, f, fullExp(f), { note: { thrown } });
  });
  add(`D2.12-${kind} Redis unavailable`, async () => {
    const f = await paid(kind);
    const c = child("redis-down", f, { REDIS_URL: "redis://127.0.0.1:6399" });
    await waitFor(() => c.out().includes("DONE"), 90_000);
    c.p.kill("SIGKILL");
    await sleep(500);
    await verify(`D2.12-${kind} Redis unavailable`, f, fullExp(f), { note: c.out().split("\n").find((l) => l.startsWith("CANCELLED"))?.slice(0, 160) ?? c.out().slice(-200) });
  });
}
add("D2.13 gateway-only full refund (baseline)", async () => {
  const f = await gatewayPaid();
  const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
  await bookingService.cancel({ userId: f.userId }, f.bookingId, "D12");
  await settle(f.bookingId);
  await verify("D2.13 gateway-only", f, fullExp(f), { note: { quote: q?.refundAmount } });
});

// ── run ────────────────────────────────────────────────────────────────────────────────────────────
console.log(`run ${RUN} db ${db} gatewayConfigured=${razorpayService.isConfigured} order=${REVERSE ? "reverse" : "forward"} fixture=${FX_PATH} at ${new Date().toISOString()}`);
// Finish whatever earlier test runs left behind first, so each case's recovery pass sees only its own work.
const backlog = [];
for (let i = 0; i < 20; i++) {
  const r = (await recover(1))[0]!;
  backlog.push(r);
  if (r.stale.scanned + r.retry.scanned + r.stranded.scanned === 0) break;
}
console.log(`PRE-EXISTING TEST BACKLOG settled before the matrix: ${JSON.stringify(backlog.map((r) => [r.stale.scanned, r.retry.scanned, r.stranded.scanned]))}`);
const ledgerBefore = await ledger();
console.log("LEDGER BEFORE", JSON.stringify(ledgerBefore));

for (const c of ordered(cases)) {
  try {
    await c.run();
  } catch (e) {
    rec(c.id, false, `THREW ${(e as Error).message.slice(0, 300)}`);
  }
}

await sleep(2000);
{
  const { processOutboxBatch } = await import("../../src/events/core/outbox-processor");
  for (let i = 0; i < 30; i++) {
    const n = (await one(`SELECT count(*)::int n FROM event_outbox WHERE status::text IN ('PENDING','PROCESSING')`)).n as number;
    if (!n) break;
    await processOutboxBatch();
    await sleep(200);
  }
}
const ledgerAfter = await ledger();
console.log("LEDGER AFTER", JSON.stringify(ledgerAfter));
rec("W whole-ledger balanced, no duplicate keys, no negative wallet, no payment over-refund",
  ledgerAfter.unbalanced === 0 && ledgerAfter.dr_eq_cr === true && ledgerAfter.dup_journal_keys === 0 && ledgerAfter.dup_wallet_keys === 0 && ledgerAfter.negative === 0 && ledgerAfter.payment_overrun === 0,
  JSON.stringify(ledgerAfter));
const integ = await financialIntegrityService.validate();
const bookingIds = new Set(((await prisma.booking.findMany({ where: { description: `D12 ${RUN}` }, select: { id: true } })) as Array<{ id: string }>).map((b) => b.id));
const paymentIds = new Set(((await prisma.payment.findMany({ where: { bookingId: { in: [...bookingIds] } }, select: { id: true } })) as Array<{ id: string }>).map((p) => p.id));
const mine = integ.issues.filter((i) => "referenceId" in i && (bookingIds.has(String(i.referenceId)) || paymentIds.has(String(i.referenceId))));
rec("I product integrity reports nothing against this run's bookings or payments", mine.length === 0, `run issues ${JSON.stringify(mine).slice(0, 300)}; all categories ${JSON.stringify(integ.issues.map((i) => i.category))}`);
const leftover = await one(`SELECT (SELECT count(*)::int FROM event_outbox WHERE status::text IN ('PENDING','PROCESSING')) outbox,
  (SELECT count(*)::int FROM refund_requests rr JOIN payments p ON p.id=rr.payment_id JOIN bookings b ON b.id=p.booking_id WHERE b.description=$1 AND rr.status::text IN ('REFUNDING','INDETERMINATE','PROCESSING')) non_terminal`, `D12 ${RUN}`);
rec("E egress blocked, outbox drained, no refund left non-terminal", egressAttempts.length === 0 && leftover.outbox === 0 && leftover.non_terminal === 0, `egress ${egressAttempts.length}; ${JSON.stringify(leftover)}`);

const fails = results.filter((r) => !r.ok);
console.log(`\nMATRIX ${RUN}: ${results.length - fails.length} PASS / ${fails.length} FAIL`);
for (const f of fails) console.log(`  FAILED ${f.id}`);
await prisma.$disconnect();
process.exit(fails.length ? 1 : 0);
