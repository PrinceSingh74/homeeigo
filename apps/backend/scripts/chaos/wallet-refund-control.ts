/**
 * Wallet-paid booking refund — isolated POSITIVE CONTROL (homigo_test only, no gateway, no real funds).
 *
 * Proves, through the real production services, whether a booking paid in full from the wallet and then
 * cancelled gets the refund its own cancellation quote promises. Writes nothing to any database other
 * than homigo_test; refuses to run otherwise. Every outbound non-loopback request is refused and counted.
 *
 *   DATABASE_URL=...homigo_test REDIS_URL=redis://localhost:6380 bun scripts/chaos/wallet-refund-control.ts
 */
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/\/homigo_test(\?|$)/.test(dbUrl)) {
  console.error("REFUSED: DATABASE_URL must target homigo_test");
  process.exit(2);
}

// Egress guard: loopback only. Anything else is refused and counted as an isolation failure.
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
const { financialIntegrityService } = await import("../../src/services/financial-integrity.service");

const db = ((await prisma.$queryRawUnsafe(`SELECT current_database() AS d`)) as Array<{ d: string }>)[0]?.d;
if (db !== "homigo_test") {
  console.error(`REFUSED: connected database is ${db}`);
  process.exit(2);
}

const RUN = `WRC-${Date.now().toString(36)}`;
const PRICE = 1000;
const one = async (sql: string, ...a: unknown[]) =>
  ((await prisma.$queryRawUnsafe(sql, ...a)) as Array<Record<string, unknown>>)[0] ?? {};

async function wholeLedger() {
  return {
    ...(await one(`SELECT count(*)::int journals, coalesce(sum(debit),0)::float debit_total, coalesce(sum(credit),0)::float credit_total,
                          coalesce(sum(debit_paise),0)::text debit_paise, coalesce(sum(credit_paise),0)::text credit_paise FROM ledger_entries`)),
    unbalanced: (await one(`SELECT count(*)::int n FROM (SELECT journal_id FROM ledger_entries GROUP BY 1 HAVING round(sum(debit)::numeric,2)<>round(sum(credit)::numeric,2) OR sum(debit_paise)<>sum(credit_paise)) x`)).n,
    orphanLines: (await one(`SELECT count(*)::int n FROM ledger_entries l WHERE NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.id=l.journal_id)`)).n,
    walletTxns: (await one(`SELECT count(*)::int n FROM wallet_transactions`)).n,
    refundRequests: (await one(`SELECT count(*)::int n FROM refund_requests`)).n,
    payments: (await one(`SELECT count(*)::int n FROM payments`)).n,
    negativeWallets: (await one(`SELECT count(*)::int n FROM users WHERE wallet_balance_paise<0`)).n,
    paiseMismatch: (await one(`SELECT count(*)::int n FROM users WHERE abs(round(wallet_balance::numeric*100)-wallet_balance_paise)>0`)).n,
    dupJournalKeys: (await one(`SELECT count(*)::int n FROM (SELECT idempotency_key FROM journal_entries WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*)>1) x`)).n,
    refundOverrun: (await one(`SELECT count(*)::int n FROM payments WHERE refunded_amount > amount + 0.01`)).n,
    customerWalletOps: (await one(`SELECT coalesce(sum(wallet_balance),0)::float v FROM users`)).v,
    customerWalletLedger: (await one(`SELECT coalesce(sum(l.credit-l.debit),0)::float v FROM ledger_entries l JOIN ledger_accounts a ON a.id=l.account_id WHERE a.code='CUSTOMER_WALLET'`)).v,
  };
}

const before = await wholeLedger();
console.log(`run ${RUN} db ${db} at ${new Date().toISOString()}`);
console.log("LEDGER BEFORE", JSON.stringify(before));

// ── fixtures (tagged; kept as documented test data — journals are never deleted) ──
const service = await prisma.service.create({
  data: { name: `WRC ${RUN}`, slug: `wrc-${RUN}`.toLowerCase(), description: "wallet refund control", category: "cleaning",
    basePrice: PRICE, estimatedDuration: 60, availableCities: ["Noida"], tags: ["wrc"] },
});
const user = await prisma.user.create({
  data: { dataOrigin: "CERTIFICATION", email: `${RUN.toLowerCase()}@wrc.test`, phoneNumber: `+9170${String(Date.now()).slice(-8)}`, firstName: "WRC", lastName: "Control",
    password: "x", role: "CUSTOMER", isEmailVerified: true, isPhoneVerified: true, walletBalance: 0 },
});
const address = await prisma.address.create({
  data: { userId: user.id, label: "Home", addressLine1: "1 WRC St", city: "Noida", state: "UP", zipCode: "201301",
    fullAddress: "1 WRC St, Noida", latitude: 28.62, longitude: 77.37, isDefault: true },
});
const booking = await prisma.booking.create({
  data: { dataOrigin: "CERTIFICATION", bookingNumber: `${RUN}-B`, userId: user.id, serviceId: service.id, addressId: address.id, status: "PENDING",
    scheduledDate: new Date(Date.now() + 72 * 3_600_000), baseAmount: PRICE, finalAmount: PRICE, totalAmount: PRICE,
    paymentStatus: "PENDING", description: `WRC control ${RUN}` },
});
// Fixture funding bypasses the ledger (a gateway top-up is forbidden). Tracked: +PRICE on the ops side only.
await prisma.user.update({ where: { id: user.id }, data: { walletBalance: PRICE, walletBalancePaise: BigInt(PRICE * 100) } });

const R: Array<[string, boolean, string]> = [];
const rec = (id: string, ok: boolean, detail: string) => { R.push([id, ok, detail]); console.log(`${ok ? "HOLDS " : "FAILS "} ${id} — ${detail}`); };

// 1-2. wallet payment through the real checkout service
const pay = await walletCheckoutService.payBookingFromWallet(user.id, booking.id);
const b1 = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { paymentStatus: true, paymentMethod: true } });
const payRows = await prisma.payment.count({ where: { bookingId: booking.id } });
const w1 = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true, walletBalancePaise: true } });
rec("P1 wallet-paid booking exists", "ok" in pay && pay.ok === true, `pay=${JSON.stringify(pay)}; wallet ${w1.walletBalance} (${w1.walletBalancePaise}p)`);
rec("P2 booking paymentStatus SUCCESS, method wallet", b1.paymentStatus === "SUCCESS" && b1.paymentMethod === "wallet", `${b1.paymentStatus}/${b1.paymentMethod}; payments rows for booking = ${payRows}`);

// 3. the customer-facing quote
const quote = await bookingRefundService.quoteForBooking(booking.id, "user");
rec("P3 quote promises a full refund", quote?.refundAmount === PRICE && quote?.tier === "free", JSON.stringify(quote));

// 4. the real cancellation (same function the POST /api/bookings/:id/cancel route calls)
const cancel = await bookingService.cancel({ userId: user.id }, booking.id, `WRC control ${RUN}`);
rec("P4 cancellation performed; response promises the refund", "status" in cancel && (cancel as { refundAmount: number }).refundAmount === PRICE,
  JSON.stringify(cancel));

// The refund runs detached after the response; wait for its write-back.
let bFinal = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
for (let i = 0; i < 40 && bFinal.refundStatus === "pending"; i++) {
  await new Promise((r) => setTimeout(r, 250));
  bFinal = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
}
await new Promise((r) => setTimeout(r, 1500));
bFinal = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

// 5-6. authoritative state
const w2 = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true, walletBalancePaise: true } });
const txns = (await prisma.$queryRawUnsafe(
  `SELECT type::text, status::text, amount::float, reference_type FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at`, user.id)) as unknown[];
const refundReq = await prisma.refundRequest.findUnique({ where: { idempotencyKey: `cancel-refund:${booking.id}` } });
const refundJournal = await prisma.journalEntry.count({ where: { idempotencyKey: `wallet_booking_refund:${booking.id}` } });
const notif = await prisma.notification.count({ where: { userId: user.id, referenceId: booking.id } }).catch(() => -1);
rec("P5 actual wallet refund is ZERO", Number(w2.walletBalancePaise) === 0,
  `wallet ${w2.walletBalance} (${w2.walletBalancePaise}p) after cancel; wallet txns ${JSON.stringify(txns)}`);
rec("P6 authoritative state confirms the discrepancy",
  refundReq === null && refundJournal === 0 && bFinal.refundAmount === 0 && bFinal.refundStatus === "none",
  `booking status ${bFinal.status}, refundAmount ${bFinal.refundAmount}, refundStatus ${bFinal.refundStatus}; refund_requests ${refundReq ? refundReq.status : "none"}; ` +
    `wallet_booking_refund journal ${refundJournal}; customer notifications for booking ${notif}`);

// Support remedy path: an admin refund of the same booking
const admin = await bookingRefundService.processAdminRefund({ bookingId: booking.id, userId: user.id, adminId: user.id, amount: PRICE, reason: "WRC control" });
rec("P7 admin refund path is also unavailable for this booking", "error" in admin, JSON.stringify(admin));

const after = await wholeLedger();
console.log("LEDGER AFTER", JSON.stringify(after));
const gapBefore = Math.round((Number(before.customerWalletOps) - Number(before.customerWalletLedger)) * 100) / 100;
const gapAfter = Math.round((Number(after.customerWalletOps) - Number(after.customerWalletLedger)) * 100) / 100;
console.log(`ops-vs-ledger CUSTOMER_WALLET gap: before ${gapBefore}, after ${gapAfter}, delta ${Math.round((gapAfter - gapBefore) * 100) / 100} (tracked fixture funding +${PRICE})`);
const integ = await financialIntegrityService.validate().catch((e: Error) => ({ error: e.message }));
console.log("PRODUCT INTEGRITY validate()", JSON.stringify(integ).slice(0, 1500));
console.log(`egress attempts refused: ${egressAttempts.length} ${JSON.stringify([...new Set(egressAttempts)])}`);
console.log(`DEFECT ${R.slice(0, 7).every(([, ok]) => ok) ? "REPRODUCED" : "NOT REPRODUCED — see FAILS lines"}; fixtures tagged ${RUN}`);
await prisma.$disconnect();
process.exit(0);
export {};
