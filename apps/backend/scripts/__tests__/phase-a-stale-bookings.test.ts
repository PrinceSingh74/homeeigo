/**
 * Live-closure step B — `scripts/phase-a-stale-bookings.ts`, tested WITHOUT any live mutation.
 *
 *   cd apps/backend
 *   bun test "D:/homigo/apps/backend/scripts/__tests__/phase-a-stale-bookings.test.ts" --timeout 120000
 *
 * Everything here runs against the isolated `homigo_test` database. The four fixture bookings carry
 * the REAL booking numbers and mirror the four shapes measured on live (read-only, 2026-09-27):
 *
 *   …0612-00073  ASSIGNED, unpaid, no payments row
 *   …0615-00003  EN_ROUTE, wallet-funded through the real wallet checkout (no payments row)
 *   …0615-00012  EN_ROUTE, gateway payment ₹550
 *   …0824-00006  ACCEPTED, a payments row LABELLED `wallet` that carries a gateway payment id
 *
 * The script is always a CHILD PROCESS, as the owner will run it. Every child is started behind the
 * suite's egress barrier and an egress WITNESS, so "the provider was not called" is an observation
 * about a written record, not the absence of an error.
 *
 * No `expect(promise).resolves` anywhere — see bun-expect-resolves-pending-hang.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { provenanceForNewUser } from "../../src/lib/data-provenance";
import { walletService } from "../../src/services/wallet.service";
import { walletCheckoutService } from "../../src/services/wallet-checkout.service";
import { freshLoopClock } from "../../src/__tests__/helpers/fresh-loop-clock";
import { directInsertLiveFlags } from "../../src/lib/catalog-governance";

const BACKEND = resolve(import.meta.dir, "../..");
/** Overridable so the break-the-fix runs can point the same tests at a deliberately broken copy. */
const SCRIPT = process.env.STALE_SCRIPT ?? join(BACKEND, "scripts/phase-a-stale-bookings.ts");
const PRELOADS = {
  loadEnv: join(BACKEND, "src/load-env.ts"),
  barrier: join(BACKEND, "src/__tests__/helpers/no-external-egress.ts"),
  witness: join(BACKEND, "scripts/__tests__/helpers/egress-witness.ts"),
};
const TEST_URL = process.env.DATABASE_URL!;
const WORK = mkdtempSync(join(tmpdir(), "stepb-"));
const WITNESS = join(WORK, "egress.tsv");

const N = {
  unpaid: "HOMIGO-20260612-00073",
  walletFunded: "HOMIGO-20260615-00003",
  gateway: "HOMIGO-20260615-00012",
  walletRow: "HOMIGO-20260824-00006",
} as const;

type Run = { code: number; out: string };

async function run(args: string[], opts: { env?: Record<string, string>; loadEnv?: boolean; witness?: string } = {}): Promise<Run> {
  // Clock-safe (src/__tests__/helpers/fresh-loop-clock): Bun measures the spawn `timeout` from the loop's
  // cached clock, and several sequential blocking runs in one test left it stale enough to expire at once.
  await freshLoopClock();
  const preloads = [
    ...(opts.loadEnv === false ? [] : ["--preload", PRELOADS.loadEnv]),
    "--preload", PRELOADS.barrier,
    "--preload", PRELOADS.witness,
  ];
  const r = Bun.spawnSync([process.execPath, ...preloads, SCRIPT, ...args], {
    cwd: BACKEND,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: TEST_URL,
      // No credential: the application's dev-mock refund path is the only gateway a test may reach.
      RAZORPAY_KEY_ID: "",
      RAZORPAY_KEY_SECRET: "",
      HOMIGO_ALLOW_EXTERNAL: "",
      HOMIGO_REQUIRE_RAZORPAY: "",
      EGRESS_WITNESS_FILE: opts.witness ?? WITNESS,
      ...opts.env,
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 110_000,
  });
  return { code: r.exitCode ?? -1, out: `${r.stdout.toString()}\n${r.stderr.toString()}` };
}

const tokenOf = (out: string, label = "CONFIRMATION TOKEN") =>
  new RegExp(`${label}[^\\n]*?\\s([0-9a-f]{16})\\s*$`, "m").exec(out)?.[1] ?? null;

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
const ids: Record<keyof typeof N, string> = { unpaid: "", walletFunded: "", gateway: "", walletRow: "" };
let userA = "";
let userB = "";
let superAdmin = "";
let otherBookingNumber = "";

const rnd = () => Math.random().toString(36).slice(2, 8);

async function customer(tag: string): Promise<string> {
  const email = `stepb-${tag}-${Date.now()}-${rnd()}@test.test`;
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: `+9176${Math.floor(1e7 + Math.random() * 8e7)}`,
      firstName: "StepB",
      lastName: tag,
      password: "x".repeat(20),
      role: "CUSTOMER",
      walletBalance: 0,
    },
  });
  return u.id;
}

async function bookingFor(userId: string, number: string, data: Record<string, unknown>): Promise<string> {
  const s = await prisma.service.create({
    data: { ...directInsertLiveFlags("phase-a-stale-bookings.test"), name: `stepb-${rnd()}-${Date.now()}`, slug: `stepb-${rnd()}-${Date.now()}`, description: "x", category: "cleaning", basePrice: 500, estimatedDuration: 60 },
  });
  const a = await prisma.address.create({
    data: { userId, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
  });
  const b = await prisma.booking.create({
    data: { bookingNumber: number, userId, serviceId: s.id, addressId: a.id, ...data } as never,
  });
  return b.id;
}

async function walletBalance(userId: string): Promise<number> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;
}

/** Everything a cancel could touch, for the four bookings. Equal before and after = nothing written. */
async function fingerprint(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT b.booking_number, b.status::text, b.payment_status::text, b.refund_status, b.refund_amount, b.cancelled_at, b.updated_at,
            (SELECT count(*)::int FROM refund_requests r JOIN payments p ON p.id = r.payment_id WHERE p.booking_id = b.id) AS refund_requests,
            (SELECT coalesce(string_agg(p.status::text || ':' || p.refunded_amount, ','), '') FROM payments p WHERE p.booking_id = b.id) AS payments,
            (SELECT count(*)::int FROM wallet_transactions w WHERE w.reference_id = b.id) AS wallet_rows,
            (SELECT count(*)::int FROM notifications n WHERE n.reference_id = b.id) AS notifications,
            (SELECT wallet_balance FROM users u WHERE u.id = b.user_id) AS wallet_balance
       FROM bookings b WHERE b.booking_number IN ('${Object.values(N).join("','")}') ORDER BY 1`,
  );
  return JSON.stringify(rows);
}

beforeAll(async () => {
  // Earlier runs left these numbers on terminal rows. History stays; the number is released.
  await prisma.$executeRawUnsafe(
    `UPDATE bookings SET booking_number = booking_number || '-old-' || floor(extract(epoch from clock_timestamp()) * 1000)::text
      WHERE booking_number IN ('${Object.values(N).join("','")}')`,
  );

  userA = await customer("a");
  userB = await customer("b");

  ids.unpaid = await bookingFor(userA, N.unpaid, {
    status: "ASSIGNED", paymentStatus: "PENDING", scheduledDate: new Date("2026-06-15T17:01:34.317Z"),
    baseAmount: 550, finalAmount: 550, totalAmount: 550,
  });

  // The wallet-funded shape is produced by the REAL checkout, so it is the shape production writes.
  ids.walletFunded = await bookingFor(userA, N.walletFunded, {
    status: "PENDING", paymentStatus: "PENDING", scheduledDate: new Date(Date.now() + 72 * 3_600_000),
    baseAmount: 989, finalAmount: 989, totalAmount: 989,
  });
  const top = await walletService.addMoney(userA, 989);
  if ("error" in top) throw new Error(String(top.error));
  await walletService.verifyTopUp(userA, { razorpayOrderId: top.razorpayOrderId, razorpayPaymentId: `pay_${Date.now()}_${rnd()}`, razorpaySignature: "sig" });
  const paid = await walletCheckoutService.payBookingFromWallet(userA, ids.walletFunded);
  if (!("ok" in paid)) throw new Error(JSON.stringify(paid));
  await prisma.booking.update({ where: { id: ids.walletFunded }, data: { status: "EN_ROUTE", scheduledDate: new Date("2026-06-16T05:30:00Z") } });

  ids.gateway = await bookingFor(userB, N.gateway, {
    status: "EN_ROUTE", paymentStatus: "SUCCESS", paymentMethod: "razorpay", scheduledDate: new Date("2026-06-17T05:30:00Z"),
    baseAmount: 550, finalAmount: 550, totalAmount: 550,
  });
  await prisma.payment.create({
    data: {
      bookingId: ids.gateway, userId: userB, idempotencyKey: `booking_order:${ids.gateway}`,
      paymentMethod: "razorpay", status: "SUCCESS", amount: 550, amountPaid: 550,
      razorpayOrderId: `order_T20fix${rnd()}`, razorpayPaymentId: `pay_T20fix${rnd()}`, razorpaySignature: "sig",
    } as never,
  });

  ids.walletRow = await bookingFor(userB, N.walletRow, {
    status: "ACCEPTED", paymentStatus: "SUCCESS", paymentMethod: "wallet", scheduledDate: new Date("2026-08-29T09:43:06.633Z"),
    baseAmount: 505, finalAmount: 505, totalAmount: 505,
  });
  await prisma.payment.create({
    data: {
      bookingId: ids.walletRow, userId: userB, idempotencyKey: `booking_order:${ids.walletRow}`,
      paymentMethod: "wallet", status: "SUCCESS", amount: 505, amountPaid: 505,
      razorpayOrderId: `order_TTYfix${rnd()}`, razorpayPaymentId: `pay_e2edemo${rnd()}`, razorpaySignature: "sig",
    } as never,
  });

  // A booking that EXISTS on this database and is not one of the four.
  otherBookingNumber = `STEPB-OTHER-${Date.now()}-${rnd()}`;
  await bookingFor(userB, otherBookingNumber, {
    status: "PENDING", paymentStatus: "PENDING", scheduledDate: new Date(Date.now() + 96 * 3_600_000),
    baseAmount: 100, finalAmount: 100, totalAmount: 100,
  });

  const email = `stepb-admin-${Date.now()}-${rnd()}@test.test`;
  const admin = await prisma.user.create({
    data: { ...provenanceForNewUser(email), email, phoneNumber: `+9175${Math.floor(1e7 + Math.random() * 8e7)}`, firstName: "StepB", lastName: "Admin", password: "x".repeat(20), role: "ADMIN", walletBalance: 0 } as never,
  });
  superAdmin = admin.id;
  const role =
    (await prisma.adminRole.findFirst({ where: { name: "SUPER_ADMIN" } })) ??
    (await prisma.adminRole.create({ data: { name: "SUPER_ADMIN", description: "step-b test", createdBy: admin.id } }));
  await prisma.adminUser.create({ data: { userId: admin.id, roleId: role.id, isActive: true, grantedBy: admin.id } });
}, 120_000);

afterAll(async () => {
  // Ledger and wallet rows are history and stay. Nothing is deleted.
});

// ── 1–6, 10: refusals and dry runs. None of these may write. ────────────────────────────────────
describe("step B script — refusals and dry runs write nothing", () => {
  test("1. an unknown booking is refused before any connection is opened", async () => {
    const before = await fingerprint();
    // A port nothing listens on: reaching the database at all would be an error, not a refusal.
    const r = (await run(["--url", "postgresql://u:p@127.0.0.1:9/nowhere", "--only", "HOMIGO-20260615-00099"]));
    expect(r.code).toBe(2);
    expect(r.out).toContain("is not one of the four bookings");
    expect(await fingerprint()).toBe(before);
  });

  test("1b. a booking that exists here but is not one of the four is refused, not processed", async () => {
    const r = (await run(["--url", TEST_URL, "--only", otherBookingNumber, "--refund-policy", "full"]));
    expect(r.code).toBe(2);
    expect(r.out).toContain("is not one of the four bookings");
    expect(r.out).not.toContain("PREFLIGHT");
  });

  test("2. --apply without a target is refused, and no preflight is produced", async () => {
    const before = await fingerprint();
    const r = (await run(["--url", TEST_URL, "--apply", "--actor", superAdmin, "--refund-policy", "full", "--confirm", "0".repeat(16)]));
    expect(r.code).toBe(2);
    expect(r.out).toContain("--apply needs a target");
    expect(r.out).not.toContain("PREFLIGHT");
    expect(await fingerprint()).toBe(before);
  });

  test("2b. --all-four needs the batch token a dry run printed", async () => {
    const before = await fingerprint();
    const r = (await run(["--url", TEST_URL, "--all-four", "--apply", "--actor", superAdmin, "--refund-policy", "customer_policy", "--confirm", "0".repeat(16)]));
    expect(r.code).toBe(2);
    expect(r.out).toContain("does not match the preflight");
    expect(await fingerprint()).toBe(before);
  });

  test("3. a valid --only dry run prints the whole preflight and a token, and writes nothing", async () => {
    const before = await fingerprint();
    const r = (await run(["--url", TEST_URL, "--only", N.gateway, "--refund-policy", "customer_policy"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("default_transaction_read_only=on");
    for (const heading of ["BOOKING", "PAYMENT METHOD", "PAYMENT MODE", "POLICY", "REFUND AMOUNT", "WALLET EFFECT", "PROVIDER EFFECT", "LEDGER EFFECT", "IRREVERSIBLE EFFECTS"]) {
      expect(r.out).toContain(`  ${heading}`);
    }
    expect(tokenOf(r.out)).not.toBeNull();
    expect(r.out).toContain("DRY RUN — nothing was written");
    // Only the selected booking: the other three are not so much as listed.
    for (const other of [N.unpaid, N.walletFunded, N.walletRow]) expect(r.out).not.toContain(other);
    expect(await fingerprint()).toBe(before);
  });

  test("3b. the same dry run twice gives the same token (the preflight is deterministic)", async () => {
    const a = tokenOf((await run(["--url", TEST_URL, "--only", N.gateway, "--refund-policy", "customer_policy"])).out);
    const b = tokenOf((await run(["--url", TEST_URL, "--only", N.gateway, "--refund-policy", "customer_policy"])).out);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    const full = tokenOf((await run(["--url", TEST_URL, "--only", N.gateway, "--refund-policy", "full"])).out);
    expect(full).not.toBe(a);
  });

  test("4. a policy the application does not define is refused", async () => {
    const before = await fingerprint();
    const r = (await run(["--url", TEST_URL, "--only", N.gateway, "--refund-policy", "half"]));
    expect(r.code).toBe(2);
    expect(r.out).toContain("is not a policy the application defines");
    expect(r.out).not.toContain("PREFLIGHT");
    expect(await fingerprint()).toBe(before);
  });

  test("4b. --apply without a policy stops and names the policies; it never defaults", async () => {
    const r = (await run(["--url", TEST_URL, "--only", N.gateway, "--apply", "--actor", superAdmin, "--confirm", "0".repeat(16)]));
    expect(r.code).toBe(2);
    expect(r.out).toContain("There is no default");
    expect(r.out).toContain("customer_policy");
    expect(r.out).toContain("full");
  });

  test("5. a wallet-funded booking shows the wallet effect", async () => {
    const funded = (await run(["--url", TEST_URL, "--only", N.walletFunded, "--refund-policy", "customer_policy"]));
    expect(funded.code).toBe(0);
    expect(funded.out).toContain("[WALLET_FUNDED]");
    expect(funded.out).toContain("ACTUALLY MOVED ₹741.75");
    expect(funded.out).toMatch(/WALLET EFFECT\s+CREDIT ₹741\.75/);
    expect(funded.out).toMatch(/PROVIDER EFFECT\s+NONE/);

    const fundedFull = (await run(["--url", TEST_URL, "--only", N.walletFunded, "--refund-policy", "full"]));
    expect(fundedFull.out).toContain("ACTUALLY MOVED ₹989.00");

  });

  test("5b. a payments row LABELLED wallet that a gateway captured is a gateway tender, not a wallet credit", async () => {
    const row = (await run(["--url", TEST_URL, "--only", N.walletRow, "--refund-policy", "customer_policy"]));
    expect(row.code).toBe(0);
    expect(row.out).toContain("[GATEWAY]");
    expect(row.out).not.toContain("[WALLET_VIA_PAYMENT_ROW]");
    expect(row.out).toContain("ACTUALLY MOVED ₹378.75");
    expect(row.out).toContain('LABELLED "wallet"');
    expect(row.out).toMatch(/WALLET EFFECT\s+NONE/);
    expect(row.out).toMatch(/PROVIDER EFFECT\s+ONE refund request of ₹378\.75/);
  });

  test("6. the gateway booking shows the provider effect, and its mode is UNKNOWN until stated", async () => {
    const r = (await run(["--url", TEST_URL, "--only", N.gateway, "--refund-policy", "customer_policy"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("[GATEWAY]");
    expect(r.out).toContain("tier=late");
    expect(r.out).toContain("ACTUALLY MOVED ₹412.50");
    expect(r.out).toMatch(/PROVIDER EFFECT\s+ONE refund request of ₹412\.50/);
    expect(r.out).toMatch(/PAYMENT MODE\s+UNKNOWN/);
    expect(r.out).toMatch(/WALLET EFFECT\s+NONE/);

    const full = (await run(["--url", TEST_URL, "--only", N.gateway, "--refund-policy", "full"]));
    expect(full.out).toContain("tier=admin_full");
    expect(full.out).toContain("ACTUALLY MOVED ₹550.00");
  });

  test("6b. with a credential configured, an unverified or mismatched provider mode refuses the apply", async () => {
    const before = await fingerprint();
    const cred = { RAZORPAY_KEY_ID: "rzp_test_fixtureonly", RAZORPAY_KEY_SECRET: "fixture" };
    const base = ["--url", TEST_URL, "--only", N.gateway, "--refund-policy", "full"];

    const dry = (await run(base, { env: cred, loadEnv: false }));
    expect(dry.out).toContain("EXECUTING CREDENTIAL  TEST (rzp_test_…)");
    expect(dry.out).toContain("APPLY WOULD BE REFUSED");

    const unverified = (await run([...base, "--apply", "--actor", superAdmin, "--confirm", tokenOf(dry.out)!], { env: cred, loadEnv: false }));
    expect(unverified.code).toBe(2);
    expect(unverified.out).toContain("--provider-mode-verified");

    const dryLive = (await run([...base, "--provider-mode-verified", "LIVE"], { env: cred, loadEnv: false }));
    const mismatch = (await run([...base, "--provider-mode-verified", "LIVE", "--apply", "--actor", superAdmin, "--confirm", tokenOf(dryLive.out)!], { env: cred, loadEnv: false }));
    expect(mismatch.code).toBe(2);
    expect(mismatch.out).toContain("cannot refund a LIVE payment");

    expect(await fingerprint()).toBe(before);
  });

  test("6c. a payment the provider has never seen: NOT_FOUND is an answer, and the preflight says no money moves", async () => {
    const before = await fingerprint();
    const cred = { RAZORPAY_KEY_ID: "rzp_test_fixtureonly", RAZORPAY_KEY_SECRET: "fixture" };
    const r = (await run(["--url", TEST_URL, "--only", N.walletRow, "--refund-policy", "full", "--provider-mode-verified", "NOT_FOUND"], { env: cred, loadEnv: false }));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/PAYMENT MODE\s+NOT FOUND at the provider in either mode/);
    expect(r.out).toContain("EXPECTED TO REJECT");
    expect(r.out).toContain("NO MONEY MOVES");
    expect(r.out).toMatch(/LEDGER EFFECT\s+NONE/);
    // Not refused: the provider's rejection is the honest outcome, not a reason to stop.
    expect(r.out).not.toContain("APPLY WOULD BE REFUSED");

    const typo = (await run(["--url", TEST_URL, "--only", N.walletRow, "--refund-policy", "full", "--provider-mode-verified", "MAYBE"], { env: cred, loadEnv: false }));
    expect(typo.code).toBe(2);
    expect(typo.out).toContain("LIVE, TEST or NOT_FOUND");
    expect(await fingerprint()).toBe(before);
  });

  test("10. the existing authorization is still required, and is now checked against the database", async () => {
    const before = await fingerprint();
    const base = ["--url", TEST_URL, "--only", N.unpaid, "--refund-policy", "full"];
    const t = tokenOf((await run(base)).out)!;

    const noActor = (await run([...base, "--apply", "--confirm", t]));
    expect(noActor.code).toBe(2);
    expect(noActor.out).toContain("--apply needs --actor");

    const customerAsActor = (await run([...base, "--apply", "--actor", userA, "--confirm", t]));
    expect(customerAsActor.code).toBe(2);
    expect(customerAsActor.out).toContain("not an active SUPER_ADMIN");

    const wrongToken = (await run([...base, "--apply", "--actor", superAdmin, "--confirm", "deadbeefdeadbeef"]));
    expect(wrongToken.code).toBe(2);
    expect(wrongToken.out).toContain("does not match the preflight");

    const policyToken = tokenOf((await run(["--url", TEST_URL, "--only", N.unpaid, "--refund-policy", "customer_policy"])).out)!;
    const crossPolicy = (await run([...base, "--apply", "--actor", superAdmin, "--confirm", policyToken]));
    expect(crossPolicy.code).toBe(2);

    expect(await fingerprint()).toBe(before);
  });

  test("9. a database that is not a test database needs --allow-live as well", async () => {
    const scratch = `homigo_stepb_guard_${rnd()}`;
    await prisma.$executeRawUnsafe(`CREATE DATABASE ${scratch}`);
    try {
      const url = TEST_URL.replace(/\/[^/?]+(\?|$)/, `/${scratch}$1`);
      const r = (await run(["--url", url, "--only", N.unpaid, "--refund-policy", "full", "--apply", "--actor", superAdmin, "--confirm", "0".repeat(16)]));
      expect(r.code).toBe(2);
      expect(r.out).toContain("is not a test database");
      expect(r.out).toContain("--allow-live");
    } finally {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    }
  });
});

// ── 7: apply on the test database. What happened must be what the preflight said. ────────────────
describe("step B script — apply on the isolated database equals the preflight", () => {
  async function applyOnce(number: string, policy: string) {
    const base = ["--url", TEST_URL, "--only", number, "--refund-policy", policy];
    const dry = (await run(base));
    expect(dry.code).toBe(0);
    const t = tokenOf(dry.out);
    expect(t).not.toBeNull();
    const applied = (await run([...base, "--apply", "--actor", superAdmin, "--confirm", t!]));
    return { dry, applied, base };
  }

  test("7a. wallet-funded: the wallet is credited the quoted amount once; a replay does nothing", async () => {
    const before = await walletBalance(userA);
    const { applied, base, dry } = await applyOnce(N.walletFunded, "customer_policy");
    expect(applied.out).toContain("cancelled → status=");
    expect(applied.code).toBe(0);

    expect(Math.round((await walletBalance(userA) - before) * 100)).toBe(74_175);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: ids.walletFunded } });
    expect(b.status).toBe("CANCELLED_BY_USER");
    expect(b.cancelledBy).toBe("admin");
    expect(b.refundStatus).toBe("processed");
    expect(b.refundAmount).toBe(741.75);
    const refunds = await prisma.walletTransaction.findMany({ where: { referenceId: ids.walletFunded, type: "REFUND" } });
    expect(refunds.length).toBe(1);
    expect(refunds[0].idempotencyKey).toBe(`wallet-cancel-refund:${ids.walletFunded}`);
    expect(await prisma.payment.count({ where: { bookingId: ids.walletFunded } })).toBe(0);
    const journal = await prisma.journalEntry.findUnique({ where: { idempotencyKey: `wallet_booking_refund:${ids.walletFunded}` } });
    expect(journal).not.toBeNull();

    // Replay: the token is stale (the booking changed) and the booking is terminal either way.
    const replay = (await run([...base, "--apply", "--actor", superAdmin, "--confirm", tokenOf(dry.out)!]));
    expect(replay.code).toBe(0);
    expect(replay.out).toContain("already terminal");
    expect(replay.out).not.toContain("APPLYING");
    expect(Math.round((await walletBalance(userA) - before) * 100)).toBe(74_175);
    expect(await prisma.walletTransaction.count({ where: { referenceId: ids.walletFunded, type: "REFUND" } })).toBe(1);
  }, 120_000);

  test("7b. gateway: one refund request for the policy amount through the dev-mock gateway; a replay adds none", async () => {
    const { applied, base, dry } = await applyOnce(N.gateway, "customer_policy");
    expect(applied.code).toBe(0);

    const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId: ids.gateway } });
    expect(p.status).toBe("PARTIALLY_REFUNDED");
    expect(p.refundedAmount).toBe(412.5);
    const rr = await prisma.refundRequest.findMany({ where: { paymentId: p.id } });
    expect(rr.length).toBe(1);
    expect(rr[0].idempotencyKey).toBe(`cancel-refund:${ids.gateway}`);
    expect(rr[0].status).toBe("COMPLETED");
    expect(rr[0].amount).toBe(412.5);
    // The dev-mock id: proof the refund was answered locally and no provider was involved.
    expect(rr[0].gatewayRefundId?.startsWith("rfnd_dev_")).toBe(true);
    expect(await walletBalance(userB)).toBe(0);

    const replay = (await run([...base, "--apply", "--actor", superAdmin, "--confirm", tokenOf(dry.out)!]));
    expect(replay.code).toBe(0);
    expect(replay.out).toContain("already terminal");
    expect(await prisma.refundRequest.count({ where: { paymentId: p.id } })).toBe(1);
  }, 120_000);

  test("7c. wallet-LABELLED gateway payment: refunded through the gateway, and the wallet is not credited", async () => {
    const before = await walletBalance(userB);
    const { applied } = await applyOnce(N.walletRow, "full");
    expect(applied.code).toBe(0);

    // No store credit was minted for money the wallet never paid.
    expect(await walletBalance(userB)).toBe(before);
    expect(await prisma.walletTransaction.count({ where: { referenceId: ids.walletRow } })).toBe(0);
    const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId: ids.walletRow } });
    expect(p.status).toBe("REFUNDED");
    const rr = await prisma.refundRequest.findMany({ where: { paymentId: p.id } });
    expect(rr.length).toBe(1);
    expect(rr[0].idempotencyKey).toBe(`cancel-refund:${ids.walletRow}`);
    expect(rr[0].status).toBe("COMPLETED");
    // The dev-mock gateway's id. The wallet path would have written `wallet:<txn id>` here.
    expect(rr[0].gatewayRefundId?.startsWith("rfnd_dev_")).toBe(true);
  }, 120_000);

  test("7d. unpaid: nothing moves, nothing is recorded, and the customer is not told a refund is coming", async () => {
    const before = await walletBalance(userA);
    const { applied, dry } = await applyOnce(N.unpaid, "customer_policy");
    expect(dry.out).toContain("[NONE_UNPAID]");
    expect(dry.out).toContain("recorded and announced ₹0.00");
    expect(dry.out).toContain("ACTUALLY MOVED ₹0.00");
    expect(applied.code).toBe(0);

    expect(await walletBalance(userA)).toBe(before);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: ids.unpaid } });
    expect(b.status).toBe("CANCELLED_BY_USER");
    expect(b.refundStatus).toBe("none");
    expect(b.refundAmount ?? 0).toBe(0);
    const n = await prisma.notification.findFirst({ where: { referenceId: ids.unpaid, type: "booking_cancelled_by_support" } });
    expect(n).not.toBeNull();
    expect(n!.message).not.toContain("refund");
  }, 120_000);
});

// ── 8: the provider was never contacted — observed, with a control proving the observer works ───
describe("step B script — no provider call", () => {
  test("8a. positive control: the witness records an outbound attempt and the barrier refuses it", () => {
    const control = join(WORK, "control.ts");
    const controlWitness = join(WORK, "control.tsv");
    writeFileSync(control, `await fetch("https://egress-positive-control.invalid/x").then(() => console.log("REACHED"), (e) => console.log(String(e?.message ?? e)));\n`);
    const r = Bun.spawnSync([process.execPath, "--preload", PRELOADS.barrier, "--preload", PRELOADS.witness, control], {
      cwd: BACKEND,
      env: { ...process.env, NODE_ENV: "test", HOMIGO_ALLOW_EXTERNAL: "", EGRESS_WITNESS_FILE: controlWitness },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = r.stdout.toString() + r.stderr.toString();
    expect(out).toContain("EGRESS_BLOCKED");
    expect(out).not.toContain("REACHED");
    const seen = readFileSync(controlWitness, "utf8");
    expect(seen).toContain("witness\tloaded");
    expect(seen).toContain("fetch\tegress-positive-control.invalid");
  });

  test("8b. across every run above, the script attempted no destination off this machine", () => {
    expect(existsSync(WITNESS)).toBe(true);
    const lines = readFileSync(WITNESS, "utf8").trim().split("\n");
    const loaded = lines.filter((l) => l === "witness\tloaded").length;
    // The witness was present in the children, so an empty host list is a finding, not a gap.
    expect(loaded).toBeGreaterThan(10);
    const local = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal", "loaded"]);
    const offMachine = lines.map((l) => l.split("\t")[1] ?? "").filter((h) => !local.has(h) && !h.startsWith("unix:"));
    expect(offMachine).toEqual([]);
    expect(lines.some((l) => /razorpay/i.test(l))).toBe(false);
  });
});
