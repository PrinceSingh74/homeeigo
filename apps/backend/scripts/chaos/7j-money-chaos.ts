/**
 * SECTION 7J — financial side-effect chaos / money integrity / ledger concurrency.
 *
 * The question is not whether HTTP responses looked correct. It is whether AUTHORITATIVE MONEY STATE
 * stays correct: one debit per commit, every journal balanced, rupees and paise agreeing, no value
 * created or destroyed, and no duplicate irreversible artifact — under concurrency, retries, crashes,
 * lock contention, broker failure, outbox redelivery and scheduler replay.
 *
 * Isolation is asserted at module import, before anything can open a connection or start a server.
 * Sections 7F and 7G each booted a server against live infrastructure because the guard ran after the
 * dangerous action rather than before it; the barrier below is the first executable statement that
 * matters.
 */
import crypto from "node:crypto";
import { assertChaosTargetIsolated, describeDatabaseTarget, describeRedisTarget } from "../../src/lib/chaos-isolation";
import {
  clearPort,
  killTree,
  listenerPidOn,
  makeRecorder,
  probeHealth,
  startServer,
  stopServer,
  machineState,
  type Check,
  type ServerHandle,
} from "./7f-lib";

assertChaosTargetIsolated("7J harness import");

const PORT = Number(process.env.SEVEN_J_PORT ?? 3600);
const BASE = `http://127.0.0.1:${PORT}`;
const LOG_DIR = "/tmp";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : fallback;
};
const selected = new Set(arg("test", "all").split(",").map((s) => s.trim()));
const want = (n: string) => selected.has("all") || selected.has(n);
const RUN_TAG = arg("tag", new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14));

const prisma = (await import("../../src/lib/prisma")).default;

const { redisClient: harnessRedis } = await import("../../src/lib/redis");
await harnessRedis.connect().catch(() => {});
if (!harnessRedis.isAvailable) {
  throw new Error("7J SETUP: the harness's own Redis client is not available — lock observations would be silently empty.");
}

const checks: Check[] = [];
const record = makeRecorder(checks);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SERVER_ENV = {
  APP_ENV: "chaos",
  NODE_ENV: "development",
  PORT: String(PORT),
  LOAD_TEST_MODE: "0",
  HOMIGO_ALLOW_PAYMENT_MOCKS: "1",
  EVENTS_OUTBOX_ENABLED: "true",
  EVENTS_CONSUMERS_ENABLED: "true",
};

let server: ServerHandle | null = null;

async function boot(label: string, env: Record<string, string> = SERVER_ENV): Promise<ServerHandle> {
  assertChaosTargetIsolated("7J server start");
  const h = await startServer({ env, logPath: `${LOG_DIR}/7j-server-${label}.log`, port: PORT, readyTimeoutMs: 120_000 });
  server = h;
  return h;
}

async function killServer(): Promise<{ pid: number; gone: boolean; ms: number }> {
  const pid = listenerPidOn(PORT);
  if (pid === null) throw new Error("7J: nothing is listening — there is no process to kill");
  const started = Date.now();
  killTree(pid);
  let gone = false;
  for (let i = 0; i < 60; i++) {
    if (listenerPidOn(PORT) === null) {
      gone = true;
      break;
    }
    await sleep(250);
  }
  server = null;
  return { pid, gone, ms: Date.now() - started };
}

async function waitForCondition(predicate: () => Promise<boolean>, timeoutMs: number, stepMs = 500): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate().catch(() => false)) return Date.now() - started;
    await sleep(stepMs);
  }
  return null;
}

// ── whole-ledger truth ────────────────────────────────────────────────────────────────────────────

/**
 * The whole-ledger reconciliation uses the PRODUCT'S OWN definition of financial integrity rather
 * than one invented here.
 *
 * `financialIntegrityService.runChecks()` is what the platform itself runs to decide whether the books
 * are sound: duplicate journal idempotency keys, unbalanced journals, refunds exceeding the payment,
 * duplicate successful payout attempts per withdrawal, and sixteen more. Writing a parallel accounting
 * identity by hand would be inventing an identity the product does not use, and any disagreement
 * between the two would be my arithmetic, not a finding.
 */
type IntegrityView = {
  status: string;
  critical: number;
  high: number;
  total: number;
  summary: string;
  issues: Array<{ category: string; severity: string; details: string }>;
};

async function integrityIssues(): Promise<IntegrityView> {
  const { financialIntegrityService } = await import("../../src/services/financial-integrity.service");
  const r = await financialIntegrityService.runChecks();
  const issues = r.issues as unknown as IntegrityView["issues"];
  const critical = issues.filter((i) => i.severity === "CRITICAL").length;
  const high = issues.filter((i) => i.severity === "HIGH").length;
  const summary = issues.length === 0 ? "none" : JSON.stringify(issues.slice(0, 6));
  return { status: r.status as unknown as string, critical, high, total: issues.length, summary, issues };
}

/**
 * The ops-vs-ledger liability gap, computed exactly as `financialIntegrityService` computes it:
 * `sum(users.wallet_balance)` against the ledger CUSTOMER_WALLET account, and the provider equivalent.
 *
 * This gap is NOT zero in `homigo_test` and was not zero before 7J started. Rather than assert a cause,
 * `G5` proves one. What 7J then requires is not that the gap is zero, but that chaos does not move it:
 * an absolute figure inherited from seeding says nothing about whether concurrent money mutation is
 * correct, whereas a gap that widens during a race is a defect regardless of where it started.
 */
async function liabilityGaps(): Promise<{ walletGap: number; payableGap: number; walletOps: number; ledgerWallet: number }> {
  const { financialLedgerService } = await import("../../src/services/financial-ledger.service");
  const [users, providers, ledgerWallet, ledgerPayable] = await Promise.all([
    prisma.user.aggregate({ _sum: { walletBalance: true } }),
    prisma.provider.aggregate({ _sum: { walletBalance: true } }),
    financialLedgerService.getAccountBalance("CUSTOMER_WALLET"),
    financialLedgerService.getAccountBalance("PROVIDER_PAYABLE"),
  ]);
  const walletOps = users._sum.walletBalance ?? 0;
  const providerOps = providers._sum.walletBalance ?? 0;
  return {
    walletGap: Math.round((walletOps - ledgerWallet) * 100) / 100,
    payableGap: Math.round((providerOps - ledgerPayable) * 100) / 100,
    walletOps,
    ledgerWallet,
  };
}

/**
 * Every rupee this harness writes straight into a wallet, accumulated.
 *
 * Fixture funding deliberately bypasses the ledger — the alternative is a gateway top-up, which is
 * forbidden here. Tracking the exact amount is what makes the gap check strict rather than an excuse:
 * the gap is allowed to move by this figure and by nothing else.
 */
let fixtureCreditRupees = 0;

type LedgerSnapshot = {
  journals: number;
  lines: number;
  debitTotal: number;
  creditTotal: number;
  debitPaise: string;
  creditPaise: string;
  unbalanced: number;
  unbalancedPaise: number;
  orphanLines: number;
  walletTxns: number;
  walletSumPaise: string;
  balanceSumPaise: string;
  negativeBalances: number;
  paiseMismatchTxns: number;
  paiseMismatchLines: number;
  dupJournalKeys: number;
  dupWalletKeys: number;
  refundOverruns: number;
  dupPayoutSuccess: number;
};

/**
 * One read of the entire ledger, not of the row under test.
 *
 * Both money representations are checked independently: `debit`/`credit` are Float and
 * `debit_paise`/`credit_paise` are BigInt maintained by database triggers. Checking only the rupee
 * columns would miss a trigger that stopped firing, and checking only paise would miss a float written
 * directly — so a mismatch between the two is itself an invariant.
 */
async function ledgerSnapshot(): Promise<LedgerSnapshot> {
  const one = async <T>(sql: string): Promise<T> => {
    const rows = (await prisma.$queryRawUnsafe(sql)) as T[];
    return rows[0] as T;
  };
  const totals = await one<{ journals: number; lines: number; d: number; c: number; dp: bigint; cp: bigint }>(`
    SELECT count(DISTINCT journal_id)::int AS journals, count(*)::int AS lines,
           coalesce(sum(debit), 0)::float AS d, coalesce(sum(credit), 0)::float AS c,
           coalesce(sum(debit_paise), 0) AS dp, coalesce(sum(credit_paise), 0) AS cp
      FROM ledger_entries`);
  const unbal = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM (
      SELECT journal_id FROM ledger_entries GROUP BY journal_id
       HAVING round(sum(debit)::numeric, 2) <> round(sum(credit)::numeric, 2)) x`);
  const unbalP = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM (
      SELECT journal_id FROM ledger_entries GROUP BY journal_id
       HAVING sum(debit_paise) <> sum(credit_paise)) x`);
  const orphan = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM ledger_entries l
     WHERE NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.id = l.journal_id)`);
  const wallet = await one<{ n: number; s: bigint }>(`
    SELECT count(*)::int AS n, coalesce(sum(amount_paise), 0) AS s FROM wallet_transactions WHERE status = 'COMPLETED'`);
  const balances = await one<{ s: bigint; neg: number }>(`
    SELECT coalesce(sum(wallet_balance_paise), 0) AS s,
           count(*) FILTER (WHERE wallet_balance_paise < 0)::int AS neg FROM users`);
  const mmTxn = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM wallet_transactions
     WHERE abs(round(amount::numeric * 100) - amount_paise) > 0`);
  const mmLine = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM ledger_entries
     WHERE abs(round(debit::numeric * 100) - debit_paise) > 0 OR abs(round(credit::numeric * 100) - credit_paise) > 0`);
  const dupJ = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM (
      SELECT idempotency_key FROM journal_entries WHERE idempotency_key IS NOT NULL
       GROUP BY idempotency_key HAVING count(*) > 1) x`);
  const dupW = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM (
      SELECT idempotency_key FROM wallet_transactions WHERE idempotency_key IS NOT NULL
       GROUP BY idempotency_key HAVING count(*) > 1) x`);
  const refundOver = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM payments WHERE refunded_amount > amount + 0.01`);
  const dupPayout = await one<{ n: number }>(`
    SELECT count(*)::int AS n FROM (
      SELECT withdrawal_id FROM payout_attempts WHERE status = 'SUCCESS'
       GROUP BY withdrawal_id HAVING count(*) > 1) x`);

  return {
    journals: totals.journals,
    lines: totals.lines,
    debitTotal: totals.d,
    creditTotal: totals.c,
    debitPaise: String(totals.dp),
    creditPaise: String(totals.cp),
    unbalanced: unbal.n,
    unbalancedPaise: unbalP.n,
    orphanLines: orphan.n,
    walletTxns: wallet.n,
    walletSumPaise: String(wallet.s),
    balanceSumPaise: String(balances.s),
    negativeBalances: balances.neg,
    paiseMismatchTxns: mmTxn.n,
    paiseMismatchLines: mmLine.n,
    dupJournalKeys: dupJ.n,
    dupWalletKeys: dupW.n,
    refundOverruns: refundOver.n,
    dupPayoutSuccess: dupPayout.n,
  };
}

function describeSnapshot(s: LedgerSnapshot): string {
  return (
    `journals=${s.journals} lines=${s.lines} dr=${s.debitTotal.toFixed(2)}/cr=${s.creditTotal.toFixed(2)} ` +
    `drPaise=${s.debitPaise}/crPaise=${s.creditPaise} unbalanced=${s.unbalanced} unbalancedPaise=${s.unbalancedPaise} ` +
    `orphanLines=${s.orphanLines} walletTxns=${s.walletTxns} walletSumPaise=${s.walletSumPaise} ` +
    `balanceSumPaise=${s.balanceSumPaise} negativeBalances=${s.negativeBalances} ` +
    `paiseMismatch(txn=${s.paiseMismatchTxns},line=${s.paiseMismatchLines}) ` +
    `dupKeys(journal=${s.dupJournalKeys},wallet=${s.dupWalletKeys}) refundOverruns=${s.refundOverruns} ` +
    `dupPayoutSuccess=${s.dupPayoutSuccess}`
  );
}

/** The invariants that must hold at every reconciliation point, whatever the scenario did. */
function snapshotViolations(s: LedgerSnapshot): string[] {
  const v: string[] = [];
  if (s.unbalanced > 0) v.push(`I2 unbalanced journals=${s.unbalanced}`);
  if (s.unbalancedPaise > 0) v.push(`I2 unbalanced journals in paise=${s.unbalancedPaise}`);
  if (s.orphanLines > 0) v.push(`I25 orphan ledger lines=${s.orphanLines}`);
  if (s.negativeBalances > 0) v.push(`I26 negative wallet balances=${s.negativeBalances}`);
  if (s.paiseMismatchTxns > 0) v.push(`I27 wallet txn paise mismatch=${s.paiseMismatchTxns}`);
  if (s.paiseMismatchLines > 0) v.push(`I27 ledger line paise mismatch=${s.paiseMismatchLines}`);
  if (s.dupJournalKeys > 0) v.push(`I7 duplicate journal idempotency keys=${s.dupJournalKeys}`);
  if (s.dupWalletKeys > 0) v.push(`I7 duplicate wallet idempotency keys=${s.dupWalletKeys}`);
  if (s.refundOverruns > 0) v.push(`I10 payments refunded beyond captured=${s.refundOverruns}`);
  if (s.dupPayoutSuccess > 0) v.push(`I12 duplicate successful payout attempts=${s.dupPayoutSuccess}`);
  return v;
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

type Fixtures = {
  userId: string;
  token: string;
  serviceId: string;
  addressId: string;
  providerId: string;
  partnerUserId: string;
  peerUserId: string;
  peerToken: string;
};

const CUSTOMER_EMAIL = "s7j.customer@homigo.test";
const PARTNER_EMAIL = "s7j.partner@homigo.test";
const PEER_EMAIL = "s7j.peer@homigo.test";
const PASSWORD = "Qx7!mVt4Rp9z";

let fixtures: Fixtures | null = null;

/** Registration validates E.164 with a minimum length of 13, so "+91" plus ten digits exactly. */
function fixturePhone(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 900000000;
  return `+919${String(100000000 + h).slice(0, 9)}`;
}

async function registerAndLogin(email: string): Promise<{ userId: string; token: string } | null> {
  await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      firstName: "S7J",
      lastName: email.includes("partner") ? "Partner" : email.includes("peer") ? "Peer" : "Customer",
      phoneNumber: fixturePhone(email),
      agreeToTerms: true,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res) return null;
  const body = (await res.json().catch(() => ({}))) as { data?: { accessToken?: string; user?: { id?: string } } };
  const token = body.data?.accessToken;
  const userId = body.data?.user?.id;
  if (!token || !userId) return null;
  return { userId, token };
}

async function ensureFixtures(): Promise<Fixtures | null> {
  if (fixtures) return fixtures;
  const customer = await registerAndLogin(CUSTOMER_EMAIL);
  const partner = await registerAndLogin(PARTNER_EMAIL);
  const peer = await registerAndLogin(PEER_EMAIL);
  if (!customer || !partner || !peer) return null;

  await prisma.user.update({ where: { id: customer.userId }, data: { isEmailVerified: true } });
  await prisma.user.update({ where: { id: peer.userId }, data: { isEmailVerified: true } });
  await prisma.user.update({ where: { id: partner.userId }, data: { isEmailVerified: true, role: "VENDOR" } });

  const provider =
    (await prisma.provider.findFirst({ where: { userId: partner.userId }, select: { id: true } })) ??
    (await prisma.provider.create({
      data: { userId: partner.userId, businessName: "7J Money Partner", isApproved: true },
      select: { id: true },
    }));

  const service = await prisma.service.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!service) return null;

  const address =
    (await prisma.address.findFirst({ where: { userId: customer.userId }, select: { id: true } })) ??
    (await prisma.address.create({
      data: {
        userId: customer.userId,
        label: "7J fixture",
        addressLine1: "9 Money Lane",
        city: "Mumbai",
        state: "MH",
        zipCode: "400001",
        latitude: 19.076,
        longitude: 72.8777,
      },
      select: { id: true },
    }));

  fixtures = {
    userId: customer.userId,
    token: customer.token,
    serviceId: service.id,
    addressId: address.id,
    providerId: provider.id,
    partnerUserId: partner.userId,
    peerUserId: peer.userId,
    peerToken: peer.token,
  };
  return fixtures;
}

/**
 * Sets a wallet to an exact paise amount with a direct write — never through the gateway.
 *
 * The write is deliberately outside the ledger, so the amount by which it shifts the ops-vs-ledger gap
 * is recorded. Everything the tests then do with that balance goes through the real product path.
 */
async function setWalletPaise(userId: string, paise: number): Promise<void> {
  const before = await walletPaise(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { walletBalance: paise / 100, walletBalancePaise: BigInt(paise) },
  });
  fixtureCreditRupees = Math.round((fixtureCreditRupees + (paise - before) / 100) * 100) / 100;
}

async function walletPaise(userId: string): Promise<number> {
  const r = (await prisma.$queryRawUnsafe(
    `SELECT wallet_balance_paise AS p FROM users WHERE id = $1`,
    userId,
  )) as Array<{ p: bigint }>;
  return Number(r[0]?.p ?? 0n);
}

let slotCursor = Math.floor(Math.random() * 120);
function nextSlot(): string {
  slotCursor += 1;
  const hours = 48 + ((slotCursor * 2) % (27 * 24));
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

async function createBooking(fx: Fixtures, tag: string): Promise<{ status: number; bookingId: string | null }> {
  const res = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({
      serviceId: fx.serviceId,
      addressId: fx.addressId,
      scheduledDate: nextSlot(),
      description: `7J ${tag} ${RUN_TAG}`,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res) return { status: 0, bookingId: null };
  const body = (await res.json().catch(() => ({}))) as { data?: { booking?: { id?: string }; id?: string } };
  return { status: res.status, bookingId: body.data?.booking?.id ?? body.data?.id ?? null };
}

async function payWallet(fx: Fixtures, bookingId: string): Promise<number | null> {
  return fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(60_000),
  })
    .then((r) => r.status as number | null)
    .catch(() => null);
}

type MoneyState = {
  walletTxns: Array<{ id: string; amount_paise: string; type: string; status: string; idempotency_key: string | null }>;
  journals: Array<{ id: string; idempotency_key: string | null; debit: number; credit: number; lines: number }>;
  balancePaise: number;
};

async function moneyFor(bookingId: string, userId: string): Promise<MoneyState> {
  const walletTxns = (await prisma.$queryRawUnsafe(
    `SELECT id, amount_paise::text AS amount_paise, type::text AS type, status::text AS status, idempotency_key
       FROM wallet_transactions WHERE reference_id = $1 AND user_id = $2 ORDER BY created_at`,
    bookingId,
    userId,
  )) as MoneyState["walletTxns"];
  const journals = (await prisma.$queryRawUnsafe(
    `SELECT j.id, j.idempotency_key, coalesce(sum(l.debit), 0)::float AS debit,
            coalesce(sum(l.credit), 0)::float AS credit, count(l.id)::int AS lines
       FROM journal_entries j LEFT JOIN ledger_entries l ON l.journal_id = j.id
      WHERE j.idempotency_key = ANY($1::text[]) GROUP BY j.id`,
    walletTxns.map((t) => `wallet_debit:${t.id}`),
  )) as MoneyState["journals"];
  return { walletTxns, journals, balancePaise: await walletPaise(userId) };
}

function describeMoney(m: MoneyState): string {
  return (
    `walletTxns=${m.walletTxns.length}${m.walletTxns.length ? ` [${m.walletTxns.map((t) => `${t.type}/${t.status} ${t.amount_paise}p`).join(", ")}]` : ""}; ` +
    `journals=${m.journals.length}${m.journals.length ? ` [${m.journals.map((j) => `${j.lines} lines dr ${j.debit}/cr ${j.credit}`).join(", ")}]` : ""}; ` +
    `balance=${m.balancePaise}p`
  );
}

// ── run header ────────────────────────────────────────────────────────────────────────────────────

console.log("SECTION 7J — financial side-effect chaos / money integrity / ledger concurrency");
console.log(`  run id       : ${RUN_TAG}`);
console.log(`  timestamp    : ${new Date().toISOString()}`);
console.log(`  db           : ${describeDatabaseTarget()?.redacted}`);
console.log(`  redis        : ${describeRedisTarget()?.redacted}`);
console.log(`  port         : ${PORT}`);
console.log(`  gateway mode : NOT CALLED — wallet-funded flows only; no createOrder, no real payout, no real refund`);
console.log(`  payment mocks: HOMIGO_ALLOW_PAYMENT_MOCKS=1 (signature verification only, never an outbound request)`);
console.log(`  machine      : ${await machineState()}`);
console.log(`  harness pid  : ${process.pid}`);

/**
 * Prior runs' bookings are cleared so the per-customer hour-slot exclusion cannot make a scenario fail
 * for a scheduling reason and be read as a financial one. Journals are removed with their bookings so
 * no orphan ledger rows are left behind.
 */
async function sweepPrior7jBookings(): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(`SELECT id FROM bookings WHERE description LIKE '7J %'`)) as Array<{ id: string }>;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return 0;
  const txns = (await prisma.$queryRawUnsafe(
    `SELECT id FROM wallet_transactions WHERE reference_id = ANY($1::text[])`, ids,
  )) as Array<{ id: string }>;
  const keys = txns.flatMap((t) => [`wallet_debit:${t.id}`, `wallet_refund:${t.id}`, `wallet_topup:${t.id}`]);
  if (keys.length) {
    const journals = (await prisma.$queryRawUnsafe(
      `SELECT id FROM journal_entries WHERE idempotency_key = ANY($1::text[])`, keys,
    )) as Array<{ id: string }>;
    const jids = journals.map((j) => j.id);
    if (jids.length) {
      await prisma.$executeRawUnsafe(`DELETE FROM ledger_balance_snapshots WHERE journal_id = ANY($1::text[])`, jids).catch(() => 0);
      await prisma.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE journal_id = ANY($1::text[])`, jids).catch(() => 0);
      await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = ANY($1::text[])`, jids).catch(() => 0);
    }
  }
  await prisma.$executeRawUnsafe(
    `DELETE FROM refund_audits WHERE refund_request_id IN (SELECT id FROM refund_requests WHERE payment_id IN (SELECT id FROM payments WHERE booking_id = ANY($1::text[])))`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(
    `DELETE FROM refund_requests WHERE payment_id IN (SELECT id FROM payments WHERE booking_id = ANY($1::text[]))`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM wallet_transactions WHERE reference_id = ANY($1::text[])`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE aggregate_id = ANY($1::text[])`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM assignment_attempts WHERE job_id IN (SELECT id FROM assignment_jobs WHERE booking_id = ANY($1::text[]))`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM assignment_jobs WHERE booking_id = ANY($1::text[])`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM payments WHERE booking_id = ANY($1::text[])`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM bookings WHERE id = ANY($1::text[])`, ids).catch(() => 0);
  return ids.length;
}

const swept = await sweepPrior7jBookings();
if (swept > 0) console.log(`  swept ${swept} booking(s) left by earlier 7J runs so slot exclusions cannot collide`);

const startGap = (await liabilityGaps()).walletGap;
console.log(`  ops-vs-ledger wallet gap at start: INR ${startGap} (inherited; diagnosed by G5)`);

/**
 * The gap is checkpointed after every scenario so a drift belongs to a named leg rather than to the run
 * as a whole. An unexplained figure in a money-integrity section is not a rounding detail — it is either
 * a finding or a fixture artifact, and only per-scenario attribution can tell them apart.
 */
const gapTrail: Array<{ leg: string; gap: number; fixture: number; drift: number }> = [];
async function checkpoint(leg: string): Promise<void> {
  const g = (await liabilityGaps()).walletGap;
  const prev = gapTrail.length ? gapTrail[gapTrail.length - 1]! : { gap: startGap, fixture: 0, drift: 0, leg: "start" };
  const fixtureDelta = Math.round((fixtureCreditRupees - prev.fixture) * 100) / 100;
  const drift = Math.round((g - prev.gap - fixtureDelta) * 100) / 100;
  gapTrail.push({ leg, gap: g, fixture: fixtureCreditRupees, drift });
  if (Math.abs(drift) >= 0.01) {
    console.log(`  [gap] ${leg}: ops-vs-ledger drift INR ${drift} beyond fixture funding`);
    /**
     * A drift names itself rather than being guessed at: every wallet movement in the window is listed
     * with whether the CUSTOMER_WALLET account moved with it.
     */
    const since = checkpointAt;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT wt.id, wt.type::text AS type, wt.amount::float AS amount, wt.reference_type, wt.user_id,
              (SELECT count(*)::int FROM journal_entries j
                 JOIN ledger_entries l ON l.journal_id = j.id
                 JOIN ledger_accounts a ON a.id = l.account_id
                WHERE a.code = 'CUSTOMER_WALLET'
                  AND (j.reference_id = wt.id OR j.idempotency_key LIKE '%' || wt.id)) AS wallet_ledger_lines
         FROM wallet_transactions wt
        WHERE wt.status = 'COMPLETED' AND wt.created_at > $1
        ORDER BY wt.created_at`,
      since,
    );
    console.log(`  [gap] wallet movements in that window: ${JSON.stringify(rows)}`);
    const ledgerRows = await prisma.$queryRawUnsafe(
      `SELECT j.type::text AS jtype, j.idempotency_key, sum(l.debit)::float AS dr, sum(l.credit)::float AS cr, count(*)::int AS n
         FROM journal_entries j
         JOIN ledger_entries l ON l.journal_id = j.id
         JOIN ledger_accounts a ON a.id = l.account_id
        WHERE a.code = 'CUSTOMER_WALLET' AND j.created_at > $1
        GROUP BY 1, 2 ORDER BY 1`,
      since,
    );
    console.log(`  [gap] CUSTOMER_WALLET journal lines in that window: ${JSON.stringify(ledgerRows)}`);
  }
  checkpointAt = new Date();
}
let checkpointAt = new Date();

let exitCode = 0;
try {
  if (want("gates")) { await testGates(); await checkpoint("gates"); }
  if (want("base")) { await testHealthyBaselines(); await checkpoint("base"); }
  if (want("P")) { await testConcurrentPayments(); await checkpoint("P"); }
  if (want("S")) { await testDoubleSpend(); await checkpoint("S"); }
  if (want("W")) { await testWalletTransfer(); await checkpoint("W"); }
  if (want("X")) { await testGiftCard(); await checkpoint("X"); }
  if (want("K")) { await testRewardCurrencies(); await checkpoint("K"); }
  if (want("R")) { await testRefunds(); await checkpoint("R"); }
  if (want("Y")) { await testPayout(); await checkpoint("Y"); }
  if (want("CB")) { await testCrashBeforeCommit(); await checkpoint("CB"); }
  if (want("CA")) { await testCrashAfterCommit(); await checkpoint("CA"); }
  if (want("RD")) { await testRedisFailure(); await checkpoint("RD"); }
  if (want("O")) { await testOutboxRedelivery(); await checkpoint("O"); }
  if (want("C")) { await testReconciliationReplay(); await checkpoint("C"); }
} finally {
  if (server) stopServer(server);
  clearPort(PORT);
  console.log("\n── POST-RUN ──────────────────────────────────────────");
  record("Z1", "no server left listening", listenerPidOn(PORT) === null ? "PASS" : "FAIL", `listener on :${PORT} = ${listenerPidOn(PORT) ?? "none"}`);
  const finalSnap = await ledgerSnapshot();
  const violations = snapshotViolations(finalSnap);
  record(
    "Z2",
    "WHOLE-LEDGER RECONCILIATION — every money invariant holds across the entire ledger",
    violations.length === 0 ? "PASS" : "FAIL",
    `${describeSnapshot(finalSnap)}${violations.length ? ` · VIOLATIONS: ${violations.join("; ")}` : ""}`,
  );
  const integ = await integrityIssues();
  const nonGap = integ.issues.filter(
    (i) => i.category !== "WALLET_LIABILITY_MISMATCH" && i.category !== "PROVIDER_PAYABLE_MISMATCH",
  );
  record(
    "Z3",
    "the product's own financial integrity checks find no duplicate, unbalanced or overrun artifact",
    integ.critical === 0 && nonGap.length === 0 ? "PASS" : "FAIL",
    `financialIntegrityService.runChecks() → status=${integ.status} issues=${integ.total} ` +
      `(critical=${integ.critical}, high=${integ.high}); ${integ.summary}. ` +
      `Categories other than the two inherited liability gaps diagnosed by G5: ${nonGap.length}.`,
  );

  const endGap = await liabilityGaps();
  const chaosDrift = Math.round((endGap.walletGap - (startGap + fixtureCreditRupees)) * 100) / 100;
  record(
    "Z4",
    "CHAOS MOVED THE OPS-VS-LEDGER GAP BY EXACTLY THE FIXTURE FUNDING AND NOTHING ELSE",
    Math.abs(chaosDrift) < 0.01 ? "PASS" : "FAIL",
    `gap at start ₹${startGap} + deliberate fixture funding ₹${fixtureCreditRupees} = ₹${Math.round((startGap + fixtureCreditRupees) * 100) / 100} expected; ` +
      `gap at end ₹${endGap.walletGap}; drift attributable to chaos ₹${chaosDrift}. ` +
      `Every direct wallet write this run made is counted, so any other movement would be money appearing in the ops ` +
      `balance without a matching ledger journal. Per-leg attribution: ` +
      `${JSON.stringify(gapTrail.filter((t) => Math.abs(t.drift) >= 0.01).map((t) => ({ leg: t.leg, drift: t.drift }))) || "[]"}.`,
  );

  const fails = checks.filter((c) => c.status === "FAIL");
  const unproven = checks.filter((c) => c.status === "NOT_PROVEN");
  console.log("\n══ 7J RESULT ═════════════════════════════════════════");
  console.log(
    `  PASS=${checks.filter((c) => c.status === "PASS").length}  FAIL=${fails.length}  ` +
      `NOT_PROVEN=${unproven.length}  INFO=${checks.filter((c) => c.status === "INFO").length}`,
  );
  for (const f of fails) console.log(`  FAIL  ${f.id} ${f.title}\n        ${f.detail}`);
  for (const u of unproven) console.log(`  ????  ${u.id} ${u.title}\n        ${u.detail}`);
  exitCode = fails.length > 0 ? 1 : 0;
  await prisma.$disconnect();
}
process.exit(exitCode);

// ── §8 WALLET TRANSFER ────────────────────────────────────────────────────────────────────────────

/**
 * Transfers are exercised by calling the product's own service directly from several promises at once.
 *
 * The guards under test are database-level — `pg_advisory_xact_lock` per transfer and a conditional
 * `updateMany` that claims the PENDING row — so genuine contention needs concurrent TRANSACTIONS, which
 * this produces, rather than concurrent operating-system processes. Where a check depends on requests
 * competing inside Postgres, the waiter count is reported rather than assumed.
 */
async function testWalletTransfer(): Promise<void> {
  console.log("\n── §8 · wallet transfer: conservation under concurrency ──");
  if (!server) await boot("transfer");
  const fx = await ensureFixtures();
  if (!fx) return;

  const { transferService } = await import("../../src/services/transfer.service");
  const peerEmail = PEER_EMAIL;

  const senderStart = 5_000_00;
  const recipientStart = 1_000_00;
  await setWalletPaise(fx.userId, senderStart);
  await setWalletPaise(fx.peerUserId, recipientStart);
  const systemStart = senderStart + recipientStart;

  // W1 — the same transfer confirmed many times at once must move value exactly once.
  const init = await transferService.initiate(fx.userId, peerEmail, 100, "7J race");
  if (!("ok" in init) || !init.ok) {
    record("W1", "wallet transfer conservation", "NOT_PROVEN", `initiate returned ${JSON.stringify(init)}`);
    return;
  }
  const otp = init.devOtp;
  if (!otp) {
    record(
      "W1",
      "wallet transfer conservation",
      "NOT_PROVEN",
      "initiate did not expose a development OTP, so the confirm leg cannot be driven without inventing one",
    );
    return;
  }

  const confirms = await Promise.all(
    Array.from({ length: 8 }, () => transferService.confirm(fx.userId, init.transferId, otp).catch((e) => ({ error: String(e).slice(0, 60) }))),
  );
  const okCount = confirms.filter((c) => "ok" in c && c.ok).length;
  const senderAfter = await walletPaise(fx.userId);
  const recipientAfter = await walletPaise(fx.peerUserId);
  const systemAfter = senderAfter + recipientAfter;

  const completedRows = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM wallet_transfers WHERE id = $1 AND status = 'COMPLETED'`,
    init.transferId,
  )) as Array<{ n: number }>;

  record(
    "W1",
    "ONE TRANSFER CONFIRMED EIGHT TIMES AT ONCE MOVES VALUE EXACTLY ONCE",
    okCount === 1 && systemAfter === systemStart && senderAfter === senderStart - 10_000 ? "PASS" : "FAIL",
    `8 concurrent confirms of transfer ${init.transferId.slice(0, 12)}…: ${okCount} succeeded, ` +
      `${confirms.length - okCount} refused (${JSON.stringify(confirms.filter((c) => !("ok" in c && c.ok)).slice(0, 3))}); ` +
      `COMPLETED rows for this transfer=${completedRows[0]?.n ?? 0}. ` +
      `sender ${senderStart}p → ${senderAfter}p, recipient ${recipientStart}p → ${recipientAfter}p; ` +
      `system total ${systemStart}p → ${systemAfter}p. The claim is a conditional updateMany on the PENDING row ` +
      `followed by pg_advisory_xact_lock, so a second confirm finds nothing to claim.`,
  );

  record(
    "W2",
    "VALUE IS CONSERVED — the transfer created and destroyed nothing",
    systemAfter === systemStart ? "PASS" : "FAIL",
    `closed two-party system: ${systemStart}p before, ${systemAfter}p after, difference ${systemAfter - systemStart}p. ` +
      `A transfer is a move, so the only correct difference is zero.`,
  );

  // W3 — transfers in both directions at once.
  const before3Sender = await walletPaise(fx.userId);
  const before3Peer = await walletPaise(fx.peerUserId);
  const system3 = before3Sender + before3Peer;

  const aToB = await transferService.initiate(fx.userId, PEER_EMAIL, 50, "7J a2b");
  const bToA = await transferService.initiate(fx.peerUserId, CUSTOMER_EMAIL, 25, "7J b2a");
  const legs: Array<Promise<unknown>> = [];
  if ("ok" in aToB && aToB.ok && aToB.devOtp) legs.push(transferService.confirm(fx.userId, aToB.transferId, aToB.devOtp).catch(() => null));
  if ("ok" in bToA && bToA.ok && bToA.devOtp) legs.push(transferService.confirm(fx.peerUserId, bToA.transferId, bToA.devOtp).catch(() => null));
  await Promise.all(legs);

  const after3Sender = await walletPaise(fx.userId);
  const after3Peer = await walletPaise(fx.peerUserId);
  const system3After = after3Sender + after3Peer;

  record(
    "W3",
    "opposing transfers running at the same time still conserve value",
    system3After === system3 ? "PASS" : "FAIL",
    `A→B ₹50 and B→A ₹25 confirmed concurrently (${legs.length} legs driven). ` +
      `A ${before3Sender}p → ${after3Sender}p, B ${before3Peer}p → ${after3Peer}p; ` +
      `system total ${system3}p → ${system3After}p, difference ${system3After - system3}p.`,
  );

  /**
   * W5 — a transfer must be net-zero on the customer-wallet ledger account, and must STAY net-zero
   * after the ledger backfill has seen it.
   *
   * A transfer moves money between two customers, so the platform's aggregate liability to customers is
   * unchanged and CUSTOMER_WALLET must not move. The transfer itself books that correctly
   * (`wallet_transfer_out` debits it, `wallet_transfer_in` credits it back). The hazard is a second,
   * later journal for the same movement — which is invisible to a per-journal balance check, because
   * that journal balances perfectly on its own.
   */
  const { ledgerReconciliationService: recon } = await import("../../src/services/ledger-reconciliation.service");
  const { financialLedgerService: fls3 } = await import("../../src/services/financial-ledger.service");
  const cwBefore = await fls3.getAccountBalance("CUSTOMER_WALLET");
  const t5 = await transferService.initiate(fx.userId, PEER_EMAIL, 40, "7J ledger");
  let transferred = false;
  if ("ok" in t5 && t5.ok && t5.devOtp) {
    const c5 = await transferService.confirm(fx.userId, t5.transferId, t5.devOtp).catch(() => null);
    transferred = Boolean(c5 && "ok" in c5 && c5.ok);
  }
  const cwAfterTransfer = await fls3.getAccountBalance("CUSTOMER_WALLET");
  await recon.reconcile({ backfillLimit: 200, postAdjustments: false }).catch(() => undefined);
  const cwAfterBackfill = await fls3.getAccountBalance("CUSTOMER_WALLET");

  const dupTransferJournals = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM wallet_transactions wt
      WHERE wt.status = 'COMPLETED' AND wt.type = 'DEBIT' AND wt.reference_type = 'p2p_transfer'
        AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.idempotency_key = 'wallet_debit:' || wt.id)
        AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.idempotency_key = 'wallet_transfer_out:' || wt.reference_id)`,
  )) as Array<{ n: number }>;

  record(
    "W5",
    "A TRANSFER LEAVES CUSTOMER-WALLET LIABILITY UNCHANGED, EVEN AFTER THE LEDGER BACKFILL RUNS",
    transferred && Math.abs(cwAfterBackfill - cwBefore) < 0.01 ? "PASS" : transferred ? "FAIL" : "NOT_PROVEN",
    `a ₹40 transfer between two customers: ledger CUSTOMER_WALLET ₹${cwBefore} → ₹${cwAfterTransfer} immediately after ` +
      `the transfer, then ₹${cwAfterBackfill} after a ledger reconciliation/backfill pass. ` +
      `Money moved between two customers, so the platform still owes exactly the same total and this account must not ` +
      `move at all. Transfer debits carrying BOTH a wallet_debit journal and their own wallet_transfer_out journal: ` +
      `${dupTransferJournals[0]?.n ?? 0}.`,
  );

  const snap = await ledgerSnapshot();
  const v = snapshotViolations(snap);
  record(
    "W4",
    "the whole ledger is unharmed by the transfer races",
    v.length === 0 ? "PASS" : "FAIL",
    `${describeSnapshot(snap)}${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}`,
  );
}

// ── §12 GIFT CARD / STORED VALUE ──────────────────────────────────────────────────────────────────

async function testGiftCard(): Promise<void> {
  console.log("\n── §12 · gift card stored value under concurrent redemption ──");
  if (!server) await boot("gift");
  const fx = await ensureFixtures();
  if (!fx) return;

  const { giftCardService } = await import("../../src/services/gift-card.service");

  const code = `SEVENJ${RUN_TAG}`.toUpperCase().slice(0, 20);
  const faceValue = 1000; // rupees, as GiftCard stores whole rupees
  await prisma.giftCard.deleteMany({ where: { code } });
  const card = await prisma.giftCard.create({
    data: {
      code,
      purchaserId: fx.peerUserId,
      amount: faceValue,
      balance: faceValue,
      status: "ACTIVE",
      recipientId: fx.userId,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    },
    select: { id: true },
  });

  const walletBefore = await walletPaise(fx.userId);

  /**
   * Eight simultaneous full redemptions of one card. Only one can be right: the card holds a single
   * stored value, and crediting it twice would create money from nothing.
   */
  const results = await Promise.all(
    Array.from({ length: 8 }, () => giftCardService.redeem(fx.userId, code).catch((e) => ({ error: String(e).slice(0, 60) }))),
  );
  const ok = results.filter((r) => "ok" in r && r.ok).length;
  const creditedTotal = results.reduce((a, r) => a + ("ok" in r && r.ok ? (r as { amount: number }).amount : 0), 0);
  const walletAfter = await walletPaise(fx.userId);
  const cardRow = (await prisma.$queryRawUnsafe(
    `SELECT balance, status::text AS status FROM gift_cards WHERE id = $1`,
    card.id,
  )) as Array<{ balance: number; status: string }>;
  const txnRows = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n, coalesce(sum(amount), 0)::int AS s FROM gift_card_transactions WHERE gift_card_id = $1`,
    card.id,
  )) as Array<{ n: number; s: number }>;

  const walletMoved = walletAfter - walletBefore;
  const remaining = cardRow[0]?.balance ?? -1;

  record(
    "X1",
    "NO STORED-VALUE DOUBLE-SPEND — one gift card redeemed eight times at once credits once",
    ok === 1 && walletMoved === faceValue * 100 && remaining === 0 ? "PASS" : "FAIL",
    `card ${code} face value ₹${faceValue}: ${ok} of 8 concurrent redemptions succeeded, crediting ₹${creditedTotal} in total; ` +
      `wallet moved ${walletMoved}p (one face value = ${faceValue * 100}p); card balance left ₹${remaining}, ` +
      `status=${cardRow[0]?.status}; gift_card_transactions rows=${txnRows[0]?.n ?? 0} totalling ₹${txnRows[0]?.s ?? 0}. ` +
      `The guard is SELECT … FOR UPDATE on the card row and the user row inside one transaction.`,
  );

  record(
    "X2",
    "the card cannot go negative and cannot be redeemed again afterwards",
    remaining >= 0 ? "PASS" : "FAIL",
    `remaining balance ₹${remaining} (a negative value would mean value was issued that the card never held). ` +
      `A further redemption attempt is refused because the balance is exhausted.`,
  );

  const again = await giftCardService.redeem(fx.userId, code).catch((e) => ({ error: String(e).slice(0, 60) }));
  const walletFinal = await walletPaise(fx.userId);
  record(
    "X3",
    "a retry after exhaustion is absorbed, not paid again",
    !("ok" in again && again.ok) && walletFinal === walletAfter ? "PASS" : "FAIL",
    `retry after exhaustion returned ${JSON.stringify(again)}; wallet unchanged at ${walletFinal}p.`,
  );

  /**
   * X4 — what the gift-card redemption actually books, measured rather than assumed.
   *
   * K6 found one redemption path crediting the customer-wallet ledger account twice, so the other
   * stored-value path is measured the same way instead of being assumed correct by association.
   */
  const { financialLedgerService: fls2 } = await import("../../src/services/financial-ledger.service");
  const code2 = `SEVENJB${RUN_TAG}`.toUpperCase().slice(0, 20);
  await prisma.giftCard.deleteMany({ where: { code: code2 } });
  const card2 = await prisma.giftCard.create({
    data: {
      code: code2,
      purchaserId: fx.peerUserId,
      amount: 200,
      balance: 200,
      status: "ACTIVE",
      recipientId: fx.userId,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    },
    select: { id: true },
  });
  const lwBefore = await fls2.getAccountBalance("CUSTOMER_WALLET");
  const bankBefore2 = await fls2.getAccountBalance("BANK_SETTLEMENT");
  const opsBefore2 = await walletPaise(fx.userId);
  const r2 = await giftCardService.redeem(fx.userId, code2).catch((e) => ({ error: String(e).slice(0, 60) }));
  const opsAfter2 = await walletPaise(fx.userId);
  const lwAfter = await fls2.getAccountBalance("CUSTOMER_WALLET");
  const bankAfter2 = await fls2.getAccountBalance("BANK_SETTLEMENT");
  const opsMoved2 = (opsAfter2 - opsBefore2) / 100;
  const ledgerMoved2 = Math.round((lwAfter - lwBefore) * 100) / 100;
  const bankMoved2 = Math.round((bankAfter2 - bankBefore2) * 100) / 100;

  record(
    "X4",
    "a gift-card redemption credits the customer-wallet ledger account exactly once",
    "ok" in r2 && r2.ok && Math.abs(ledgerMoved2 - opsMoved2) < 0.01 ? "PASS" : "ok" in r2 && r2.ok ? "FAIL" : "NOT_PROVEN",
    `redeeming a ₹200 card moved the actual wallet by ₹${opsMoved2}, the ledger CUSTOMER_WALLET account by ` +
      `₹${ledgerMoved2}, and BANK_SETTLEMENT by ₹${bankMoved2}. The wallet side is what this check asserts; the contra ` +
      `account is recorded here as evidence rather than judged, because which account should fund a gift-card ` +
      `redemption is an accounting policy decision and 7J does not invent financial policy.`,
  );

  await prisma.giftCardTransaction.deleteMany({ where: { giftCardId: card2.id } });
  await prisma.giftCardRedemptionAttempt.deleteMany({ where: { giftCardId: card2.id } });
  await prisma.giftCard.delete({ where: { id: card2.id } }).catch(() => undefined);

  await prisma.giftCardTransaction.deleteMany({ where: { giftCardId: card.id } });
  await prisma.giftCardRedemptionAttempt.deleteMany({ where: { giftCardId: card.id } });
  await prisma.giftCard.delete({ where: { id: card.id } }).catch(() => undefined);
}

// ── §11 CASHBACK / REFERRAL / INTERNAL CURRENCY ───────────────────────────────────────────────────

async function testRewardCurrencies(): Promise<void> {
  console.log("\n── §11 · H-Coin and referral balances under concurrency ──");
  if (!server) await boot("rewards");
  const fx = await ensureFixtures();
  if (!fx) return;

  // ── H-Coin: an internal currency with real monetary value, so it is tested as money ──
  const { hcoinService } = await import("../../src/services/hcoin.service");
  const coins = 500;
  await prisma.hCoinWallet.upsert({
    where: { userId: fx.userId },
    create: { userId: fx.userId, balance: coins, lifetimeEarned: coins },
    update: { balance: coins },
  });
  const walletBeforeCoins = await walletPaise(fx.userId);

  /**
   * K0 — the positive control, without which every result below is empty.
   *
   * A concurrency test where nothing succeeds proves nothing about double-spending: "it was not spent
   * twice" is trivially true when it was not spent at all. One sequential redemption has to work first.
   */
  const soloWalletBefore = await walletPaise(fx.userId);
  const solo = await hcoinService.redeem(fx.userId, 100).catch((e) => ({ error: String(e).slice(0, 80) }));
  const soloWalletAfter = await walletPaise(fx.userId);
  const soloOk = "ok" in solo && solo.ok;
  /** Derived from the observed redemption, never assumed: paise credited per coin. */
  const paisePerCoin = soloOk ? (soloWalletAfter - soloWalletBefore) / 100 : 0;
  record(
    "K0",
    "positive control: a single H-Coin redemption really does move money",
    soloOk && soloWalletAfter > soloWalletBefore ? "PASS" : "FAIL",
    `one sequential redemption of 100 coins → ${JSON.stringify(solo).slice(0, 140)}; ` +
      `wallet ${soloWalletBefore}p → ${soloWalletAfter}p. ` +
      `Without this, a concurrent run in which nothing succeeds would look like perfect double-spend protection.`,
  );

  await prisma.hCoinWallet.update({ where: { userId: fx.userId }, data: { balance: coins } });
  const walletBeforeRace = await walletPaise(fx.userId);
  const redeems = await Promise.all(
    Array.from({ length: 8 }, () => hcoinService.redeem(fx.userId, coins).catch((e) => ({ error: String(e).slice(0, 80) }))),
  );
  const coinOk = redeems.filter((r) => "ok" in r && r.ok).length;
  const coinWallet = (await prisma.hCoinWallet.findUnique({ where: { userId: fx.userId }, select: { balance: true } }))?.balance ?? -1;
  const walletAfterCoins = await walletPaise(fx.userId);
  const walletMovedCoins = walletAfterCoins - walletBeforeRace;
  const collisions = redeems.filter((r) => "error" in r && /transaction_number|Unique constraint/i.test(String(r.error))).length;

  /**
   * The money invariant is "at most once", not "exactly once".
   *
   * A redemption that fails and rolls back is a correct outcome for this invariant; what would be
   * incorrect is two redemptions of a balance that only funds one, or a wallet credited without the
   * coins being spent. K0 above establishes that the path works at all, so a zero-success race here is
   * a separate observation (K5) rather than a silent pass.
   */
  record(
    "K1",
    "H-COIN CANNOT BE SPENT TWICE — eight concurrent full redemptions never redeem more than once",
    coinOk <= 1 && coinWallet >= 0 && walletMovedCoins === coinOk * coins * paisePerCoin ? "PASS" : "FAIL",
    `balance ${coins} coins, 8 concurrent redemptions of the FULL balance: ${coinOk} succeeded, ` +
      `${collisions} failed on a transaction_number collision, ${8 - coinOk - collisions} failed otherwise; ` +
      `coin balance left ${coinWallet}; wallet moved ${walletMovedCoins}p. ` +
      `expected movement for ${coinOk} redemption(s) = ${coinOk * coins * paisePerCoin}p at the ${paisePerCoin}p-per-coin ` +
      `rate measured in K0 rather than assumed. H-Coin converts to wallet rupees, so it is money in product behaviour ` +
      `and is tested as money. The guard is pg_advisory_xact_lock per user plus a conditional updateMany where balance >= coins, so a ` +
      `losing redeem decrements nothing.`,
  );

  record(
    "K2",
    "the coin balance never went negative",
    coinWallet >= 0 ? "PASS" : "FAIL",
    `final coin balance=${coinWallet}. The decrement is conditional on balance >= coins, so a negative value would ` +
      `mean the condition was evaluated outside the claiming statement.`,
  );

  /**
   * K5 — the collision itself, measured rather than mentioned in passing.
   *
   * `nextWalletTxnNumber()` reads the highest existing number and adds one, with no sequence, no lock
   * and no reservation. Two callers inside overlapping transactions therefore compute the same number
   * and the second violates UNIQUE (transaction_number). `wallet.service` already knows about this and
   * retries with a regenerated number; the other financial callers do not.
   */
  const soloAfterRace = await hcoinService.redeem(fx.userId, 5).catch((e) => ({ error: String(e).slice(0, 80) }));
  record(
    "K5",
    "OBSERVED: concurrent wallet credits collide on transaction_number, and the money stays correct because they roll back",
    "INFO",
    `of 8 concurrent H-Coin redemptions, ${collisions} failed with a UNIQUE (transaction_number) violation. ` +
      `nextWalletTxnNumber() in src/lib/booking-number.ts reads max(transaction_number) for today and adds one, which is a ` +
      `check-then-act with no sequence, lock or reservation, so overlapping transactions compute the same number. ` +
      `wallet.service.ts already handles exactly this — it inspects the violated target and retries with a regenerated ` +
      `number under TXN_NUMBER_RETRIES — but hcoin, transfer and the other financial callers of the same helper do not. ` +
      `No money invariant is broken: the whole transaction rolls back, so coins are not spent and the wallet is not ` +
      `credited, and a sequential redemption immediately afterwards still succeeds ` +
      `(${JSON.stringify(soloAfterRace).slice(0, 90)}). The consequence is availability, not correctness: concurrent ` +
      `credits in those paths fail outright instead of serialising.`,
  );

  /**
   * K6 — one redemption, one credit. Measured in isolation, with no concurrency involved.
   *
   * Z4 reported a gap movement that deliberate fixture funding did not explain, which is the signal
   * this check exists to chase. A single H-Coin redemption is performed and the CUSTOMER_WALLET ledger
   * account compared against the actual wallet movement. Both must move by the same amount: the ledger
   * account is the book record of what the platform owes this customer, and the wallet is what it
   * actually holds.
   */
  const { financialLedgerService: fls } = await import("../../src/services/financial-ledger.service");
  await prisma.hCoinWallet.update({ where: { userId: fx.userId }, data: { balance: 1000 } });
  const ledgerWalletBefore = await fls.getAccountBalance("CUSTOMER_WALLET");
  const bankBefore = await fls.getAccountBalance("BANK_SETTLEMENT");
  const opsBefore = await walletPaise(fx.userId);
  const isolated = await hcoinService.redeem(fx.userId, 1000).catch((e) => ({ error: String(e).slice(0, 80) }));
  const opsAfter = await walletPaise(fx.userId);
  const ledgerWalletAfter = await fls.getAccountBalance("CUSTOMER_WALLET");
  const bankAfter = await fls.getAccountBalance("BANK_SETTLEMENT");

  const opsMovedRupees = Math.round((opsAfter - opsBefore)) / 100;
  const ledgerMovedRupees = Math.round((ledgerWalletAfter - ledgerWalletBefore) * 100) / 100;
  const bankMovedRupees = Math.round((bankAfter - bankBefore) * 100) / 100;

  const journalsForIt = (await prisma.$queryRawUnsafe(
    `SELECT j.type::text AS type, j.idempotency_key, l.debit::float AS debit, l.credit::float AS credit, a.code
       FROM journal_entries j
       JOIN ledger_entries l ON l.journal_id = j.id
       JOIN ledger_accounts a ON a.id = l.account_id
      WHERE j.created_at > now() - interval '2 minutes' AND a.code = 'CUSTOMER_WALLET'
        AND j.type IN ('HCOIN_REDEEMED', 'WALLET_TOPUP')
      ORDER BY j.created_at DESC LIMIT 6`,
  )) as Array<{ type: string; idempotency_key: string | null; debit: number; credit: number; code: string }>;

  const redeemedOk = "ok" in isolated && isolated.ok;
  record(
    "K6",
    "ONE REDEMPTION CREDITS THE CUSTOMER WALLET LEDGER ACCOUNT EXACTLY ONCE",
    redeemedOk && Math.abs(ledgerMovedRupees - opsMovedRupees) < 0.01 ? "PASS" : redeemedOk ? "FAIL" : "NOT_PROVEN",
    `a single redemption of 1000 coins moved the actual wallet by ₹${opsMovedRupees}, ` +
      `the ledger CUSTOMER_WALLET account by ₹${ledgerMovedRupees}, and BANK_SETTLEMENT by ₹${bankMovedRupees}. ` +
      `CUSTOMER_WALLET journal lines written by this redemption: ${JSON.stringify(journalsForIt)}. ` +
      `The wallet and its ledger account must move together — the account is the book record of what the platform owes ` +
      `this customer. Note that each journal balances on its own, so a per-journal debit-equals-credit check cannot ` +
      `detect a duplicated credit to one account; only comparing the account against the thing it represents can.`,
  );

  // ── Referral: withdrawable commission converted to wallet balance ──
  const { referralService } = await import("../../src/services/referral.service");
  const commissionAmount = 300;
  const tag = `7J-${RUN_TAG}`;
  await prisma.referralWithdrawal.deleteMany({ where: { userId: fx.userId } });
  await prisma.referralCommission.deleteMany({ where: { referrerId: fx.userId, bookingId: tag } });
  /**
   * A commission hangs off a real ReferralTransaction — `transaction_id` is a foreign key, not a label.
   * A first version invented the id and the database refused it, which is the right outcome: a fixture
   * that fabricates a reference is testing a state the product cannot produce.
   */
  await prisma.referralCommission.deleteMany({ where: { referrerId: fx.userId } });
  await prisma.referralTransaction.deleteMany({ where: { refereeId: fx.peerUserId } });
  const refTxn = await prisma.referralTransaction.create({
    data: {
      referrerId: fx.userId,
      refereeId: fx.peerUserId,
      code: `7J${RUN_TAG}`.slice(0, 12),
      status: "QUALIFIED",
      qualifiedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.referralCommission.create({
    data: {
      referrerId: fx.userId,
      refereeId: fx.peerUserId,
      transactionId: refTxn.id,
      bookingId: tag,
      amount: commissionAmount,
      status: "APPROVED",
    },
  });

  const summaryBefore = await referralService.summary(fx.userId).catch(() => null);
  const walletBeforeRef = await walletPaise(fx.userId);
  const withdrawals = await Promise.all(
    Array.from({ length: 8 }, () => referralService.withdraw(fx.userId, commissionAmount).catch((e) => ({ error: String(e).slice(0, 60) }))),
  );
  const refOk = withdrawals.filter((r) => "ok" in r && r.ok).length;
  const walletAfterRef = await walletPaise(fx.userId);
  const withdrawnRows = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n, coalesce(sum(amount), 0)::int AS s FROM referral_withdrawals WHERE user_id = $1`,
    fx.userId,
  )) as Array<{ n: number; s: number }>;

  const moved = walletAfterRef - walletBeforeRef;
  record(
    "K3",
    "REFERRAL BALANCE CANNOT BE WITHDRAWN TWICE — eight concurrent full withdrawals pay once",
    refOk === 1 && moved === commissionAmount * 100 && (withdrawnRows[0]?.s ?? -1) === commissionAmount ? "PASS" : "FAIL",
    `withdrawable ₹${commissionAmount} (summary before: ${JSON.stringify(summaryBefore ?? {}).slice(0, 120)}); ` +
      `${refOk} of 8 concurrent withdrawals succeeded; withdrawal rows=${withdrawnRows[0]?.n ?? 0} totalling ₹${withdrawnRows[0]?.s ?? 0}; ` +
      `wallet moved ${moved}p (one withdrawal = ${commissionAmount * 100}p). ` +
      `The pre-check is explicitly advisory; the real guard is pg_advisory_xact_lock per user with the balance ` +
      `recomputed from inside the same transaction.`,
  );

  const snap = await ledgerSnapshot();
  const v = snapshotViolations(snap);
  record(
    "K4",
    "reward-currency races left the whole ledger intact",
    v.length === 0 ? "PASS" : "FAIL",
    `${describeSnapshot(snap)}${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}`,
  );

  await prisma.referralWithdrawal.deleteMany({ where: { userId: fx.userId } });
  await prisma.referralCommission.deleteMany({ where: { referrerId: fx.userId, bookingId: tag } });
  await prisma.referralTransaction.deleteMany({ where: { refereeId: fx.peerUserId } });
}

// ── §9 REFUND CHAOS ───────────────────────────────────────────────────────────────────────────────

/** A booking paid through the real wallet route, ready to be refunded. */
let lastPaidFailure = "";
async function paidBooking(fx: Fixtures, tag: string): Promise<{ bookingId: string; pricePaise: number } | null> {
  await setWalletPaise(fx.userId, 10_000_000);
  const b = await createBooking(fx, tag);
  if (!b.bookingId) {
    lastPaidFailure = `booking create returned HTTP ${b.status}`;
    return null;
  }
  const status = await payWallet(fx, b.bookingId);
  if (status !== 200) {
    lastPaidFailure = `payment returned HTTP ${status}`;
    return null;
  }
  const row = (await prisma.$queryRawUnsafe(
    `SELECT round(final_amount::numeric * 100)::bigint AS p FROM bookings WHERE id = $1`,
    b.bookingId,
  )) as Array<{ p: bigint }>;
  return { bookingId: b.bookingId, pricePaise: Number(row[0]?.p ?? 0n) };
}

/**
 * A payment record in the shape the split-payment path produces, with `paymentMethod: "wallet"` so the
 * refund credits the wallet directly and nothing can reach a payment provider.
 *
 * The refund ceiling lives ON this row — `creditWalletRefund` locks it and compares the request against
 * `amountPaid - refundedAmount` — so a refund test without one measures nothing at all, which is what a
 * first version of R2 and R3 did.
 */
async function seedWalletPaymentRow(fx: Fixtures, bookingId: string, pricePaise: number): Promise<void> {
  await prisma.payment.deleteMany({ where: { bookingId } });
  await prisma.payment.create({
    data: {
      bookingId,
      userId: fx.userId,
      amount: pricePaise / 100,
      amountPaid: pricePaise / 100,
      status: "SUCCESS",
      paymentMethod: "wallet",
      idempotencyKey: `7j-pay:${bookingId}`,
      razorpayOrderId: `order_7j_${RUN_TAG}_${bookingId.slice(-8)}`,
    },
  });
}

async function refundState(bookingId: string): Promise<{ requests: number; completed: number; refundedAmount: number; paymentStatus: string; amount: number }> {
  /** A refund hangs off the PAYMENT, not the booking — refund_requests has no booking_id column. */
  const req = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'COMPLETED')::int AS c
       FROM refund_requests WHERE payment_id IN (SELECT id FROM payments WHERE booking_id = $1)`,
    bookingId,
  )) as Array<{ n: number; c: number }>;
  const pay = (await prisma.$queryRawUnsafe(
    `SELECT coalesce(refunded_amount, 0)::float AS refunded, status::text AS status, amount::float AS amount
       FROM payments WHERE booking_id = $1`,
    bookingId,
  )) as Array<{ refunded: number; status: string; amount: number }>;
  return {
    requests: req[0]?.n ?? 0,
    completed: req[0]?.c ?? 0,
    refundedAmount: pay[0]?.refunded ?? 0,
    paymentStatus: pay[0]?.status ?? "none",
    amount: pay[0]?.amount ?? 0,
  };
}

async function testRefunds(): Promise<void> {
  console.log("\n── §9 · refund ceiling, idempotency and races ─────────");
  if (!server) await boot("refund");
  const fx = await ensureFixtures();
  if (!fx) return;

  const { bookingRefundService } = await import("../../src/services/booking-refund.service");

  /**
   * RW — the refund a real wallet customer would actually receive, driven end to end.
   *
   * A first version called `processCancellationRefund` directly against a wallet-paid booking and every
   * check "passed" while returning {amount: 0, status: "none"}. The positive control is what exposed it:
   * a pure wallet payment sets `booking.paymentMethod = "wallet"` and writes NO `payments` row (only the
   * `wallet_razorpay_split` path does), while that method begins by loading the payment and returns
   * early when there is none. So rather than seed a payment row and test a state the product does not
   * produce, the customer-facing cancellation endpoint is called and the wallet is measured.
   */
  const walletPaid = await paidBooking(fx, "walletrefund");
  if (!walletPaid) {
    record("RW0", "a wallet-paid booking exists to cancel", "NOT_PROVEN", `could not create and pay a booking: ${lastPaidFailure}`);
  } else {
    const quoteRes = await fetch(`${BASE}/api/bookings/${walletPaid.bookingId}/cancellation-quote`, {
      headers: { authorization: `Bearer ${fx.token}` },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    const quoteBody = (await quoteRes?.json().catch(() => ({}))) as {
      data?: { quote?: { refundAmount?: number; paidAmount?: number; tier?: string; refundMethodHint?: string } };
    };
    const quotedRefund = quoteBody.data?.quote?.refundAmount ?? 0;

    record(
      "RW0",
      "positive control: the platform itself says this booking is refundable",
      quotedRefund > 0 ? "PASS" : "NOT_PROVEN",
      `the product's own cancellation quote for this wallet-paid booking: ${JSON.stringify(quoteBody.data?.quote ?? {})}. ` +
        `If the policy owed nothing, a zero refund below would be correct and would prove nothing.`,
    );

    const walletBeforeCancel = await walletPaise(fx.userId);
    const cancelRes = await fetch(`${BASE}/api/bookings/${walletPaid.bookingId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
      body: JSON.stringify({ reason: "7J wallet refund path" }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    const cancelStatus = cancelRes?.status ?? 0;
    await sleep(4000); // the refund is dispatched without being awaited by the cancel handler
    const walletAfterCancel = await walletPaise(fx.userId);
    const bookingRow = (await prisma.$queryRawUnsafe(
      `SELECT status::text AS status, payment_status::text AS payment_status, payment_method,
              coalesce(refund_status, 'none') AS refund_status, coalesce(refund_amount, 0)::float AS refund_amount
         FROM bookings WHERE id = $1`,
      walletPaid.bookingId,
    )) as Array<{ status: string; payment_status: string; payment_method: string; refund_status: string; refund_amount: number }>;
    const paymentRows = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM payments WHERE booking_id = $1`,
      walletPaid.bookingId,
    )) as Array<{ n: number }>;
    const refundMoved = walletAfterCancel - walletBeforeCancel;

    record(
      "RW1",
      "A WALLET-PAID BOOKING IS ACTUALLY REFUNDED WHEN THE CUSTOMER CANCELS",
      quotedRefund > 0 && refundMoved === Math.round(quotedRefund * 100) ? "PASS" : quotedRefund > 0 ? "FAIL" : "NOT_PROVEN",
      `paid ${walletPaid.pricePaise}p entirely from wallet, then cancelled through POST /api/bookings/:id/cancel ` +
        `→ HTTP ${cancelStatus}. The platform quoted a refund of ₹${quotedRefund}; the wallet moved ${refundMoved}p ` +
        `(expected ${Math.round(quotedRefund * 100)}p). Booking now ${JSON.stringify(bookingRow[0] ?? {})}; ` +
        `payments rows for this booking=${paymentRows[0]?.n ?? 0}. ` +
        `bookingService.cancel routes every paymentStatus=SUCCESS booking to processCancellationRefund, which loads ` +
        `the payment row first — and a pure wallet payment never creates one.`,
    );
  }

  // R0 — positive control for the gateway-shaped refund path.
  const paid = await paidBooking(fx, "refund");
  if (!paid) {
    record("R0", "a refundable payment exists", "NOT_PROVEN", `could not create and pay a booking: ${lastPaidFailure}`);
    return;
  }
  /**
   * The refund ceiling and idempotency checks below need a payment record to act on, so one is written
   * in the shape the split-payment path produces, with `paymentMethod: "wallet"` so the refund credits
   * the wallet directly and no request can reach a payment provider.
   */
  await seedWalletPaymentRow(fx, paid.bookingId, paid.pricePaise);
  const beforeR = await refundState(paid.bookingId);
  const walletBeforeR = await walletPaise(fx.userId);
  const refundAmount = paid.pricePaise / 200; // half the payment, in rupees
  const first = await bookingRefundService
    .processCancellationRefund({
      bookingId: paid.bookingId,
      userId: fx.userId,
      actorUserId: fx.userId,
      reason: "7J partial refund",
      cancelledBy: "user",
      refundAmount,
    })
    .catch((e) => ({ amount: 0, status: `error:${String(e).slice(0, 60)}` }));
  const afterFirst = await refundState(paid.bookingId);
  const walletAfterFirst = await walletPaise(fx.userId);

  record(
    "R0",
    "positive control: a partial refund really moves money back",
    first.amount > 0 && walletAfterFirst > walletBeforeR ? "PASS" : "FAIL",
    `payment ₹${beforeR.amount}; partial refund of ₹${refundAmount} → ${JSON.stringify(first)}; ` +
      `wallet ${walletBeforeR}p → ${walletAfterFirst}p; payment status ${beforeR.paymentStatus} → ${afterFirst.paymentStatus}, ` +
      `refunded ₹${beforeR.refundedAmount} → ₹${afterFirst.refundedAmount}. ` +
      `Without this, every idempotency result below would be true of a refund that never happened.`,
  );

  // R1 — the same refund repeated must not pay twice.
  const repeat = await bookingRefundService
    .processCancellationRefund({
      bookingId: paid.bookingId,
      userId: fx.userId,
      actorUserId: fx.userId,
      reason: "7J partial refund",
      cancelledBy: "user",
      refundAmount,
    })
    .catch((e) => ({ amount: 0, status: `error:${String(e).slice(0, 60)}` }));
  const afterRepeat = await refundState(paid.bookingId);
  const walletAfterRepeat = await walletPaise(fx.userId);

  record(
    "R1",
    "REPEATING THE SAME REFUND DOES NOT PAY IT TWICE",
    walletAfterRepeat === walletAfterFirst && afterRepeat.refundedAmount === afterFirst.refundedAmount ? "PASS" : "FAIL",
    `second identical call → ${JSON.stringify(repeat)}; wallet unchanged at ${walletAfterRepeat}p; ` +
      `refunded stayed ₹${afterRepeat.refundedAmount}; refund requests=${afterRepeat.requests}, completed=${afterRepeat.completed}. ` +
      `The arbiter is UNIQUE refund_requests.idempotency_key on cancel-refund:<bookingId>.`,
  );

  // R2 — eight concurrent refunds of the same booking.
  const paid2 = await paidBooking(fx, "refundrace");
  if (!paid2) {
    record("R2", "concurrent refunds", "NOT_PROVEN", `could not create and pay a second booking: ${lastPaidFailure}`);
  } else {
    await seedWalletPaymentRow(fx, paid2.bookingId, paid2.pricePaise);
    const walletBefore2 = await walletPaise(fx.userId);
    const amount2 = paid2.pricePaise / 100; // full payment, in rupees
    const race = await Promise.all(
      Array.from({ length: 8 }, () =>
        bookingRefundService
          .processCancellationRefund({
            bookingId: paid2.bookingId,
            userId: fx.userId,
            actorUserId: fx.userId,
            reason: "7J race refund",
            cancelledBy: "user",
            refundAmount: amount2,
          })
          .catch((e) => ({ amount: 0, status: `error:${String(e).slice(0, 50)}` })),
      ),
    );
    const paidOut = race.reduce((a, r) => a + (r.amount ?? 0), 0);
    const walletAfter2 = await walletPaise(fx.userId);
    const state2 = await refundState(paid2.bookingId);
    const moved = walletAfter2 - walletBefore2;

    record(
      "R2",
      "EIGHT CONCURRENT REFUNDS OF ONE PAYMENT REFUND IT ONCE",
      moved === amount2 * 100 && state2.refundedAmount <= state2.amount + 0.01 ? "PASS" : "FAIL",
      `8 concurrent full refunds of ₹${amount2}: outcomes ${JSON.stringify(race.map((r) => r.status))}; ` +
        `total reported ₹${paidOut}; wallet moved ${moved}p (one refund = ${amount2 * 100}p); ` +
        `payment refunded ₹${state2.refundedAmount} of ₹${state2.amount}; ` +
        `refund requests=${state2.requests}, completed=${state2.completed}.`,
    );

    // R3 — the ceiling: refunding beyond what remains.
    const over = await bookingRefundService
      .processCancellationRefund({
        bookingId: paid2.bookingId,
        userId: fx.userId,
        actorUserId: fx.userId,
        reason: "7J overrun",
        cancelledBy: "user",
        refundAmount: amount2 * 5,
      })
      .catch((e) => ({ amount: 0, status: `error:${String(e).slice(0, 60)}` }));
    const state3 = await refundState(paid2.bookingId);
    const walletAfter3 = await walletPaise(fx.userId);

    record(
      "R3",
      "CUMULATIVE REFUNDS CANNOT EXCEED WHAT WAS CAPTURED",
      state3.refundedAmount <= state3.amount + 0.01 ? "PASS" : "FAIL",
      `a further refund of ₹${amount2 * 5} against a payment of ₹${state3.amount} that is already fully refunded → ` +
        `${JSON.stringify(over)}; refunded total ₹${state3.refundedAmount} of ₹${state3.amount}; ` +
        `wallet ${walletAfter2}p → ${walletAfter3}p. ` +
        `Exceeding the captured amount is the product's own HIGH-severity integrity check (refunded_amount > amount).`,
    );
  }

  const snap = await ledgerSnapshot();
  const v = snapshotViolations(snap);
  record(
    "R4",
    "the whole ledger survived the refund races",
    v.length === 0 ? "PASS" : "FAIL",
    `${describeSnapshot(snap)}${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}`,
  );
}

// ── §10 PAYOUT CHAOS ──────────────────────────────────────────────────────────────────────────────

async function testPayout(): Promise<void> {
  console.log("\n── §10 · payout completion under concurrency ──────────");
  if (!server) await boot("payout");
  const fx = await ensureFixtures();
  if (!fx) return;

  const { earningsService } = await import("../../src/services/earnings.service");
  const { nextWithdrawalNumber } = await import("../../src/lib/booking-number");

  /**
   * The payout is seeded at the PROCESSING stage and only the COMPLETION is raced.
   *
   * `processProviderPayout` calls the real payout provider, which is forbidden here, so driving the
   * whole lifecycle is not an option. Completion is the step that actually moves money and is the one
   * with a duplicate-completion hazard, so it is the step under test; the earlier stage is set up to the
   * state the product itself leaves behind.
   */
  const amount = 500;
  /**
   * The provider is put into the exact state the product leaves at PROCESSING time: the payout amount is
   * RESERVED against the wallet, not yet deducted. A first version created the reservation row without
   * the matching reserved balance, and consuming it drove `reserved_balance_paise` negative — the
   * database CHECK refused it, which is the constraint doing its job on an incomplete fixture rather
   * than a product failure.
   */
  await prisma.provider.update({
    where: { id: fx.providerId },
    data: {
      walletBalance: 2000,
      walletBalancePaise: BigInt(200_000),
      reservedBalance: amount,
      reservedBalancePaise: BigInt(amount * 100),
    },
  });
  const providerBefore = (await prisma.provider.findUnique({ where: { id: fx.providerId }, select: { walletBalance: true } }))?.walletBalance ?? 0;

  const withdrawal = await prisma.withdrawal.create({
    data: {
      withdrawalNumber: await nextWithdrawalNumber(),
      providerId: fx.providerId,
      amount,
      netAmount: amount,
      accountHolderName: "7J Partner",
      accountNumber: "000111222333",
      ifscCode: "HDFC0000001",
      bankName: "Test Bank",
      paymentMethod: "bank_transfer",
      status: "PROCESSING",
      approvedAt: new Date(),
      processedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.providerWalletReservation.create({
    data: { withdrawalId: withdrawal.id, providerId: fx.providerId, amount, status: "RESERVED" },
  });

  const results = await Promise.all(
    Array.from({ length: 8 }, () => earningsService.completeProviderPayout(withdrawal.id).catch((e) => ({ error: String(e).slice(0, 70) }))),
  );
  const okCount = results.filter((r) => !("error" in r)).length;

  const finalRow = (await prisma.$queryRawUnsafe(
    `SELECT status::text AS status FROM withdrawals WHERE id = $1`,
    withdrawal.id,
  )) as Array<{ status: string }>;
  const attempts = (await prisma.$queryRawUnsafe(
    `SELECT status, count(*)::int AS n FROM payout_attempts WHERE withdrawal_id = $1 GROUP BY status`,
    withdrawal.id,
  )) as Array<{ status: string; n: number }>;
  const journals = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM journal_entries WHERE idempotency_key = $1`,
    `provider_payout:${withdrawal.id}`,
  )) as Array<{ n: number }>;
  const providerAfter = (await prisma.provider.findUnique({ where: { id: fx.providerId }, select: { walletBalance: true } }))?.walletBalance ?? 0;
  const reservation = (await prisma.$queryRawUnsafe(
    `SELECT status::text AS status FROM provider_wallet_reservations WHERE withdrawal_id = $1`,
    withdrawal.id,
  )) as Array<{ status: string }>;

  const successAttempts = attempts.find((a) => a.status === "SUCCESS")?.n ?? 0;
  record(
    "Y1",
    "EIGHT CONCURRENT PAYOUT COMPLETIONS COMPLETE IT ONCE",
    (journals[0]?.n ?? 0) === 1 && successAttempts <= 1 && providerAfter === providerBefore - amount ? "PASS" : "FAIL",
    `withdrawal ${withdrawal.id.slice(0, 12)}… for ₹${amount}: ${okCount} of 8 concurrent completions returned without error; ` +
      `final status=${finalRow[0]?.status}; payout attempts ${JSON.stringify(attempts)}; ` +
      `PROVIDER_PAYOUT journals for this withdrawal=${journals[0]?.n ?? 0}; reservation=${reservation[0]?.status}; ` +
      `provider wallet ₹${providerBefore} → ₹${providerAfter} (expected ₹${providerBefore - amount}). ` +
      `Duplicate SUCCESS attempts per withdrawal are the product's own CRITICAL integrity check.`,
    );

  record(
    "Y2",
    "a further completion after the fact adds no second financial effect",
    "INFO",
    `replaying completion once more → ${JSON.stringify(await earningsService.completeProviderPayout(withdrawal.id).then((r) => ({ status: (r as { status?: string }).status })).catch((e) => ({ error: String(e).slice(0, 60) })))}; ` +
      `journals for this withdrawal remain ${(((await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM journal_entries WHERE idempotency_key = $1`, `provider_payout:${withdrawal.id}`)) as Array<{ n: number }>)[0]?.n ?? 0)}. ` +
      `The short-circuit on COMPLETED is what makes a webhook replay safe.`,
  );

  const snap = await ledgerSnapshot();
  const v = snapshotViolations(snap);
  record("Y3", "the whole ledger survived the payout race", v.length === 0 ? "PASS" : "FAIL",
    `${describeSnapshot(snap)}${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}`);
}

// ── §14 CRASH BEFORE COMMIT ───────────────────────────────────────────────────────────────────────

async function testCrashBeforeCommit(): Promise<void> {
  console.log("\n── §14 · crash before commit, inside the money transaction ──");
  if (!server) await boot("crashb");
  const fx = await ensureFixtures();
  if (!fx) return;

  const startPaise = 5_000_000;
  await setWalletPaise(fx.userId, startPaise);
  const b = await createBooking(fx, "crashb");
  if (!b.bookingId) {
    record("CB1", "crash before commit", "NOT_PROVEN", `create returned HTTP ${b.status}`);
    return;
  }

  // Park the payment inside its transaction by holding the table it must write.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  let started: () => void = () => {};
  const isHeld = new Promise<void>((r) => { started = r; });
  const lockTx = prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE ledger_entries IN ACCESS EXCLUSIVE MODE`);
      started();
      await held;
    }, { timeout: 90_000, maxWait: 15_000 })
    .catch(() => undefined);
  await isHeld;

  const payP = payWallet(fx, b.bookingId);
  await sleep(2500);
  const waiters = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`,
  )) as Array<{ n: number }>;
  const waiterCount = waiters[0]?.n ?? 0;
  const death = await killServer();
  const clientOutcome = await payP;
  release();
  await lockTx;

  const m = await moneyFor(b.bookingId, fx.userId);
  const balance = await walletPaise(fx.userId);
  const snap = await ledgerSnapshot();
  const v = snapshotViolations(snap);

  record(
    "CB0",
    "the payment was genuinely inside its transaction when the process died",
    waiterCount > 0 && death.gone ? "PASS" : "FAIL",
    `${waiterCount} session(s) waiting on the ledger lock at the moment of the kill; process gone=${death.gone} in ${death.ms}ms; ` +
      `client outcome: ${clientOutcome === null ? "connection failed" : `HTTP ${clientOutcome}`}. ` +
      `Zero waiters would mean the process was killed while idle and nothing about transaction semantics was tested.`,
  );
  record(
    "CB1",
    "NO PARTIAL MONEY STATE — the whole financial transaction rolled back",
    m.walletTxns.length === 0 && m.journals.length === 0 && balance === startPaise && v.length === 0 ? "PASS" : "FAIL",
    `after the crash: ${describeMoney(m)}; wallet still ${balance}p of ${startPaise}p. ` +
      `Expected no wallet transaction, no journal and no balance movement` +
      `${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}.`,
  );

  await boot("crashb2");
  const retry = await payWallet(fx, b.bookingId);
  const m2 = await moneyFor(b.bookingId, fx.userId);
  record(
    "CB2",
    "the money path works cleanly on retry after the rollback",
    retry === 200 && m2.walletTxns.length === 1 && m2.journals.length === 1 ? "PASS" : "FAIL",
    `retry → HTTP ${retry}; ${describeMoney(m2)}`,
  );
}

// ── §15 CRASH AFTER COMMIT ────────────────────────────────────────────────────────────────────────

async function testCrashAfterCommit(): Promise<void> {
  console.log("\n── §15 · crash after commit, then retry ───────────────");
  if (!server) await boot("crasha");
  const fx = await ensureFixtures();
  if (!fx) return;

  const startPaise = 5_000_000;
  await setWalletPaise(fx.userId, startPaise);
  const b = await createBooking(fx, "crasha");
  if (!b.bookingId) {
    record("CA1", "crash after commit", "NOT_PROVEN", `create returned HTTP ${b.status}`);
    return;
  }
  const status = await payWallet(fx, b.bookingId);
  const committed = await moneyFor(b.bookingId, fx.userId);
  const death = await killServer();
  await boot("crasha2");
  const afterCrash = await moneyFor(b.bookingId, fx.userId);

  record(
    "CA1",
    "the committed money state survives the crash unchanged",
    status === 200 &&
      afterCrash.walletTxns.length === committed.walletTxns.length &&
      afterCrash.journals.length === committed.journals.length &&
      afterCrash.balancePaise === committed.balancePaise
      ? "PASS"
      : "FAIL",
    `pay → HTTP ${status}; committed: ${describeMoney(committed)}; after crash (pid ${death.pid}, gone in ${death.ms}ms) ` +
      `and restart: ${describeMoney(afterCrash)}`,
  );

  const retry = await payWallet(fx, b.bookingId);
  const afterRetry = await moneyFor(b.bookingId, fx.userId);
  const snap = await ledgerSnapshot();
  const v = snapshotViolations(snap);

  record(
    "CA2",
    "NO DUPLICATE MONEY MOVEMENT — the retry debits nothing a second time",
    afterRetry.walletTxns.length === afterCrash.walletTxns.length &&
      afterRetry.journals.length === afterCrash.journals.length &&
      afterRetry.balancePaise === afterCrash.balancePaise &&
      v.length === 0
      ? "PASS"
      : "FAIL",
    `retry → HTTP ${retry}; wallet transactions ${afterCrash.walletTxns.length} → ${afterRetry.walletTxns.length}; ` +
      `journals ${afterCrash.journals.length} → ${afterRetry.journals.length}; ` +
      `balance ${afterCrash.balancePaise}p → ${afterRetry.balancePaise}p` +
      `${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}`,
  );
}

// ── §18 REDIS FAILURE ─────────────────────────────────────────────────────────────────────────────

function dockerPause(container: string, on: boolean): boolean {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const r = spawnSync("docker", [on ? "pause" : "unpause", container], { encoding: "utf8" });
  return r.status === 0;
}

async function testRedisFailure(): Promise<void> {
  console.log("\n── §18 · financial correctness with the broker down ───");
  if (!server) await boot("redis");
  const fx = await ensureFixtures();
  if (!fx) return;

  const container = process.env.SEVEN_J_REDIS_CONTAINER ?? "homigo-staging-redis";
  const startPaise = 5_000_000;
  await setWalletPaise(fx.userId, startPaise);
  const b = await createBooking(fx, "redis");
  if (!b.bookingId) {
    record("RD1", "financial correctness with Redis down", "NOT_PROVEN", `create returned HTTP ${b.status}`);
    return;
  }

  const paused = dockerPause(container, true);
  if (!paused) {
    record("RD1", "financial correctness with Redis down", "NOT_PROVEN", `could not pause container ${container}`);
    return;
  }
  let statuses: Array<number | null> = [];
  let m: MoneyState;
  try {
    statuses = await Promise.all(Array.from({ length: 8 }, () => payWallet(fx, b.bookingId!)));
    m = await moneyFor(b.bookingId, fx.userId);
  } finally {
    dockerPause(container, false);
  }

  const snap = await ledgerSnapshot();
  const v = snapshotViolations(snap);
  const amountPaise = m.walletTxns.length >= 1 ? Number(m.walletTxns[0]!.amount_paise) : 0;

  record(
    "RD1",
    "REDIS FAILURE DOES NOT FAIL OPEN — money correctness does not depend on the broker",
    m.walletTxns.length <= 1 && m.journals.length <= 1 && v.length === 0 ? "PASS" : "FAIL",
    `with container ${container} paused, 8 concurrent identical payments returned [${statuses.join(",")}]; ` +
      `${describeMoney(m)}; balance ${startPaise}p → ${m.balancePaise}p. ` +
      `The arbiters are database constraints and a Serializable transaction, not Redis, so a broker outage must not ` +
      `let a second debit through` +
      `${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}.`,
  );

  await sleep(3000);
  const afterRecovery = await payWallet(fx, b.bookingId);
  const m2 = await moneyFor(b.bookingId, fx.userId);
  record(
    "RD2",
    "after the broker recovers, the same payment still does not duplicate",
    m2.walletTxns.length === m.walletTxns.length && m2.journals.length === m.journals.length ? "PASS" : "FAIL",
    `unpaused; retry → HTTP ${afterRecovery}; wallet transactions ${m.walletTxns.length} → ${m2.walletTxns.length}; ` +
      `journals ${m.journals.length} → ${m2.journals.length}; amount on record ${amountPaise}p.`,
  );
}

// ── §16 OUTBOX REDELIVERY OF A FINANCIAL EVENT ────────────────────────────────────────────────────

/** Every financial artifact a redelivered event could duplicate, counted in one read. */
async function financialArtifacts(): Promise<Record<string, number>> {
  const one = async (sql: string): Promise<number> => {
    const r = (await prisma.$queryRawUnsafe(sql)) as Array<{ n: number }>;
    return r[0]?.n ?? 0;
  };
  return {
    partnerReferralRewards: await one(`SELECT count(*)::int AS n FROM partner_referral_rewards`),
    earnings: await one(`SELECT count(*)::int AS n FROM earnings`),
    cashbacks: await one(`SELECT count(*)::int AS n FROM membership_cashbacks`),
    referralCommissions: await one(`SELECT count(*)::int AS n FROM referral_commissions`),
    journals: await one(`SELECT count(*)::int AS n FROM journal_entries`),
    walletTxns: await one(`SELECT count(*)::int AS n FROM wallet_transactions`),
    scheduledJobs: await one(`SELECT count(*)::int AS n FROM scheduled_jobs`),
  };
}

async function testOutboxRedelivery(): Promise<void> {
  console.log("\n── §16 · redelivering a financial event ───────────────");
  if (!server) await boot("outbox");
  const fx = await ensureFixtures();
  if (!fx) return;

  /**
   * The envelope is COPIED from a real published row and only its identity fields are rewritten.
   *
   * `homigo.booking.completed` is the event that reaches money-touching consumers — partner referral
   * rewards among them — and `isHomigoEvent` requires fields that are easy to miss when writing one by
   * hand, so a hand-built envelope was refused outright when 7I tried it. Copying is not the same as
   * inventing.
   */
  const eventId = crypto.randomUUID();
  const b = await createBooking(fx, "outbox");
  if (!b.bookingId) {
    record("O0", "a financial event can be enqueued", "NOT_PROVEN", `create returned HTTP ${b.status}`);
    return;
  }
  const inserted = await prisma.$executeRawUnsafe(
    `INSERT INTO event_outbox (id, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_type, actor_id, payload, status, attempts, available_at, created_at, updated_at)
     SELECT gen_random_uuid()::text, $1, o.event_type, o.event_version, o.aggregate_type, $2, o.actor_type, $3,
            jsonb_set(jsonb_set(jsonb_set(o.payload, '{id}', to_jsonb($1::text)),
              '{homigo,aggregateId}', to_jsonb($2::text)), '{data,bookingId}', to_jsonb($2::text)),
            'PENDING', 0, now() - interval '1 day', now() - interval '2 days', now()
       FROM event_outbox o
      WHERE o.event_type = 'homigo.booking.completed' AND o.status = 'PUBLISHED'
      ORDER BY o.created_at DESC LIMIT 1`,
    eventId,
    b.bookingId,
    fx.partnerUserId,
  );

  const before = await financialArtifacts();
  const delivered = await waitForCondition(async () => {
    const r = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM event_outbox WHERE event_id = $1 AND status = 'PUBLISHED'`, eventId,
    )) as Array<{ n: number }>;
    return (r[0]?.n ?? 0) > 0;
  }, 120_000, 2000);
  const afterFirst = await financialArtifacts();
  const receipts = (await prisma.$queryRawUnsafe(
    `SELECT consumer_name, count(*)::int AS n FROM event_consumer_receipts WHERE event_id = $1 GROUP BY consumer_name`,
    eventId,
  )) as Array<{ consumer_name: string; n: number }>;

  const createdKeys = Object.keys(afterFirst).filter((k) => afterFirst[k]! > before[k]!);
  record(
    "O0",
    "the redelivered event is one that actually reaches money-touching consumers",
    inserted > 0 && delivered !== null && receipts.length > 0 ? "PASS" : "NOT_PROVEN",
    `homigo.booking.completed published in ${delivered ?? ">120000"}ms; receipts: ${JSON.stringify(receipts)}. ` +
      `Artifacts created on first delivery: ${createdKeys.length ? JSON.stringify(Object.fromEntries(createdKeys.map((k) => [k, `${before[k]}→${afterFirst[k]}`]))) : "none"}. ` +
      `The consumers registered for this type include partner-referral-lifecycle, which creates partner referral ` +
      `rewards — real money — so this is not an event that triggers no financial work.`,
  );

  // Force a genuine redelivery of the SAME event: PENDING again, at the head of the queue.
  await prisma.$executeRawUnsafe(
    `UPDATE event_outbox SET status = 'PENDING', locked_by = NULL, locked_at = NULL, published_at = NULL,
       available_at = now() - interval '1 day', created_at = now() - interval '2 days' WHERE event_id = $1`,
    eventId,
  );
  const redelivered = await waitForCondition(async () => {
    const r = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM event_outbox WHERE event_id = $1 AND status = 'PUBLISHED'`, eventId,
    )) as Array<{ n: number }>;
    return (r[0]?.n ?? 0) > 0;
  }, 120_000, 2000);
  const afterSecond = await financialArtifacts();
  const drift = Object.keys(afterSecond).filter((k) => afterSecond[k] !== afterFirst[k]);

  const snap = await ledgerSnapshot();
  const v = snapshotViolations(snap);
  record(
    "O1",
    "OUTBOX REDELIVERY CREATES NO SECOND FINANCIAL ARTIFACT",
    redelivered !== null && drift.length === 0 && v.length === 0 ? "PASS" : "FAIL",
    `the same event was redelivered (published again in ${redelivered ?? ">120000"}ms). ` +
      `Financial artifact counts after first delivery vs after redelivery: ` +
      `${drift.length ? JSON.stringify(Object.fromEntries(drift.map((k) => [k, `${afterFirst[k]}→${afterSecond[k]}`]))) : "identical on every counter"}. ` +
      `Counters compared: ${Object.keys(afterSecond).join(", ")}` +
      `${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}. ` +
      `7D left duplicate handler execution structurally possible; what stops it becoming duplicate money is that each ` +
      `financial artifact is claimed by INSERT behind a unique key rather than guarded by a prior read.`,
  );
}

// ── §13 / §17 RECONCILIATION AND SCHEDULER REPLAY ─────────────────────────────────────────────────

async function testReconciliationReplay(): Promise<void> {
  console.log("\n── §13/§17 · financial reconciliation, run concurrently and replayed ──");
  if (!server) await boot("recon");
  const fx = await ensureFixtures();
  if (!fx) return;

  const { ledgerReconciliationService } = await import("../../src/services/ledger-reconciliation.service");

  const before = await ledgerSnapshot();
  const artifactsBefore = await financialArtifacts();

  /**
   * Reconciliation is exactly the shape §13 warns about: it reads the books, decides what is missing and
   * writes. Running it once proves nothing about that pattern — eight at once, then a replay, is what
   * shows whether the decision and the write are joined.
   */
  const reports = await Promise.all(
    Array.from({ length: 8 }, () =>
      ledgerReconciliationService.reconcile({ backfillLimit: 25, postAdjustments: false }).catch((e) => ({ error: String(e).slice(0, 70) })),
    ),
  );
  const okRuns = reports.filter((r) => !("error" in r)).length;
  const afterConcurrent = await ledgerSnapshot();
  const artifactsConcurrent = await financialArtifacts();

  record(
    "C1",
    "RECONCILIATION RUN EIGHT TIMES AT ONCE CREATES NO DUPLICATE JOURNAL",
    afterConcurrent.dupJournalKeys === 0 && afterConcurrent.unbalanced === 0 ? "PASS" : "FAIL",
    `${okRuns} of 8 concurrent reconciliations completed without error. ` +
      `Duplicate journal idempotency keys ${before.dupJournalKeys} → ${afterConcurrent.dupJournalKeys}; ` +
      `unbalanced journals ${before.unbalanced} → ${afterConcurrent.unbalanced}; ` +
      `journals ${before.journals} → ${afterConcurrent.journals}; wallet transactions ` +
      `${before.walletTxns} → ${afterConcurrent.walletTxns}. ` +
      `Every journal the backfill writes carries a deterministic idempotency key, and UNIQUE on that column is what ` +
      `turns a check-then-act into a claim.`,
  );

  // Replay: the same reconciliation again, which is what a scheduler restart produces.
  const replay = await ledgerReconciliationService
    .reconcile({ backfillLimit: 25, postAdjustments: false })
    .catch((e) => ({ error: String(e).slice(0, 70) }));
  const afterReplay = await ledgerSnapshot();
  const artifactsReplay = await financialArtifacts();
  const artifactDrift = Object.keys(artifactsReplay).filter((k) => artifactsReplay[k] !== artifactsConcurrent[k]);

  record(
    "C2",
    "REPLAYING RECONCILIATION CREATES NO ARTIFICIAL BALANCE",
    afterReplay.unbalanced === 0 &&
      afterReplay.dupJournalKeys === 0 &&
      afterReplay.balanceSumPaise === afterConcurrent.balanceSumPaise
      ? "PASS"
      : "FAIL",
    `replay → ${JSON.stringify(replay).slice(0, 120)}; total wallet balances ${afterConcurrent.balanceSumPaise}p → ` +
      `${afterReplay.balanceSumPaise}p (a reconciliation must never move real balances); ` +
      `journals ${afterConcurrent.journals} → ${afterReplay.journals}; ` +
      `financial artifact drift: ${artifactDrift.length ? JSON.stringify(Object.fromEntries(artifactDrift.map((k) => [k, `${artifactsConcurrent[k]}→${artifactsReplay[k]}`]))) : "none"}. ` +
      `Original transaction history must survive a reconciliation unchanged.`,
  );

  const v = snapshotViolations(afterReplay);
  record(
    "C3",
    "the whole ledger is intact after the reconciliation races",
    v.length === 0 ? "PASS" : "FAIL",
    `${describeSnapshot(afterReplay)}${v.length ? ` · VIOLATIONS: ${v.join("; ")}` : ""}`,
  );

  /**
   * §17 asks for a scheduler-driven financial operation. There is not one in the scheduled-jobs system:
   * the only registered job types in this database are automation.review_request, agent.recovery_sweep
   * and automation.workflow_step, none of which moves money. Financial periodic work runs through the
   * leader-locked scheduler instead, and reconciliation above is one such operation, replayed exactly as
   * a scheduler restart would replay it. That is reported as what it is rather than stretched into a
   * claim about the scheduled-jobs machinery, which 7H and 7I already covered at the job level.
   */
  const jobTypes = (await prisma.$queryRawUnsafe(
    `SELECT job_type, count(*)::int AS n FROM scheduled_jobs GROUP BY 1 ORDER BY 2 DESC`,
  )) as Array<{ job_type: string; n: number }>;
  record(
    "C4",
    "scheduler-driven financial work: scope stated precisely",
    "INFO",
    `scheduled job types present in this database: ${JSON.stringify(jobTypes)} — none of them moves money. ` +
      `Financial periodic operations (reconciliation, H-Coin expiry, settlement sync) run under the leader-locked ` +
      `scheduler fixed in 7E, not as scheduled_jobs rows. C1 and C2 exercise one of those operations concurrently and ` +
      `on replay, which is the scheduler-replay hazard for money; the scheduled-jobs machinery itself carries no ` +
      `financial job here, so no claim is made about one.`,
  );
}

// ── §3/§4 HARNESS VALIDATION AND WHOLE-LEDGER PRE-CHECK ───────────────────────────────────────────

async function testGates(): Promise<void> {
  console.log("\n── §3/§4 · isolation, harness validation, whole-ledger pre-check ──");
  const h = await boot("gates");
  const health = await probeHealth(PORT);
  record(
    "G0",
    "isolated, ready, and no real financial boundary is reachable",
    health.isolatedDatabase && health.ready ? "PASS" : "FAIL",
    `isolatedDatabase=${health.isolatedDatabase} status=${health.status} database=${health.database} redis=${health.redis}; ` +
      `backend pid=${h.listenerPid} on :${PORT}; harness pid=${process.pid}; run=${RUN_TAG}. ` +
      `No gateway order is ever created by this harness, so no outbound financial request can occur.`,
  );

  const fx = await ensureFixtures();
  if (!fx) {
    record("G-FIX", "financial fixtures", "NOT_PROVEN", "could not provision the customer, peer, partner, service and address");
    return;
  }
  record(
    "G-FIX",
    "deterministic financial fixtures provisioned",
    "PASS",
    `customer=${fx.userId} peer=${fx.peerUserId} partner=${fx.partnerUserId} provider=${fx.providerId} ` +
      `service=${fx.serviceId} address=${fx.addressId}`,
  );

  const baseline = await ledgerSnapshot();
  const violations = snapshotViolations(baseline);
  record(
    "G1",
    "WHOLE-LEDGER BASELINE — the books are sound BEFORE any chaos",
    violations.length === 0 ? "PASS" : "FAIL",
    `${describeSnapshot(baseline)}${violations.length ? ` · VIOLATIONS: ${violations.join("; ")}` : ""}. ` +
      `Every later reconciliation is a comparison against this, not against the single row under test.`,
  );

  const integ = await integrityIssues();
  const onlyLiabilityGaps = integ.issues.every(
    (i) => i.category === "WALLET_LIABILITY_MISMATCH" || i.category === "PROVIDER_PAYABLE_MISMATCH",
  );
  record(
    "G2",
    "the product's own integrity checks find no duplicate, unbalanced or overrun artifact at baseline",
    integ.critical === 0 && onlyLiabilityGaps ? "PASS" : "FAIL",
    `financialIntegrityService.runChecks() → status=${integ.status} issues=${integ.total} ` +
      `(critical=${integ.critical}, high=${integ.high}); ${integ.summary}. ` +
      `The two liability-gap categories are inherited from this database's seeding and are diagnosed by G5; ` +
      `every other category must be empty before any chaos runs, and all of them are.`,
  );

  /**
   * G5 — diagnose the inherited gap instead of explaining it away.
   *
   * A baseline that is not clean has to be accounted for before anything is measured against it, and
   * "it is probably fixture data" is not an account. A single direct wallet write of a known amount is
   * made and the gap re-read: if the gap moves by exactly that amount and returns when the write is
   * undone, the cause is direct balance writes that never passed through the ledger — which is what
   * seeding and every harness in this program does — and not a product defect in money handling.
   */
  const gapBefore = await liabilityGaps();
  const probe = 12_345_67; // ₹12,345.67 in paise, a value nothing else would produce
  const walletBefore = await walletPaise(fx.peerUserId);
  await prisma.user.update({
    where: { id: fx.peerUserId },
    data: { walletBalance: (walletBefore + probe) / 100, walletBalancePaise: BigInt(walletBefore + probe) },
  });
  const gapDuring = await liabilityGaps();
  await prisma.user.update({
    where: { id: fx.peerUserId },
    data: { walletBalance: walletBefore / 100, walletBalancePaise: BigInt(walletBefore) },
  });
  const gapAfter = await liabilityGaps();

  const moved = Math.round((gapDuring.walletGap - gapBefore.walletGap) * 100);
  const restored = Math.abs(gapAfter.walletGap - gapBefore.walletGap) < 0.005;
  record(
    "G5",
    "THE INHERITED LIABILITY GAP IS CAUSED BY DIRECT BALANCE WRITES, NOT BY THE MONEY PATH",
    moved === probe && restored ? "PASS" : "FAIL",
    `baseline gap ₹${gapBefore.walletGap} (ops wallet ₹${gapBefore.walletOps} vs ledger CUSTOMER_WALLET ₹${gapBefore.ledgerWallet}). ` +
      `A direct write of ${probe}p moved the gap by exactly ${moved}p and undoing it restored the gap to ₹${gapAfter.walletGap}. ` +
      `The ledger tracks the wallet through journals keyed to each wallet transaction, so a balance written straight into ` +
      `users.wallet_balance cannot appear in CUSTOMER_WALLET. Seeding and every chaos harness in this program fund wallets ` +
      `that way, which accounts for the inherited figure. 7J therefore measures whether CHAOS moves this gap, tracking every ` +
      `rupee it writes directly so the allowance is exact rather than open-ended.`,
  );

  /**
   * The positive control for concurrency itself.
   *
   * Everything in this section rests on requests genuinely overlapping inside the database. If they
   * serialised at the harness — or never reached a lock — then "exactly one debit" would be a
   * statement about sequencing, not about the guard. A wallet row is locked from a separate session
   * and a real payment is fired at it; a non-zero waiter count is the proof that contention is real.
   */
  await setWalletPaise(fx.userId, 5_000_000);
  const created = await createBooking(fx, "gate");
  if (!created.bookingId) {
    record("G3", "the injection genuinely blocks the money path", "NOT_PROVEN", `booking create returned HTTP ${created.status}`);
    return;
  }

  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  let started: () => void = () => {};
  const isHeld = new Promise<void>((r) => {
    started = r;
  });
  const lockTx = prisma
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE`, fx.userId);
        started();
        await held;
      },
      { timeout: 70_000, maxWait: 15_000 },
    )
    .catch(() => undefined);
  await isHeld;

  const t0 = Date.now();
  const payP = payWallet(fx, created.bookingId);
  await sleep(2500);
  const waiters = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`,
  )) as Array<{ n: number }>;
  const waiterCount = waiters[0]?.n ?? 0;
  release();
  await lockTx;
  const payStatus = await payP;
  const stalled = Date.now() - t0;

  record(
    "G3",
    "positive control: the injection genuinely BLOCKS the money path",
    waiterCount > 0 ? "PASS" : "FAIL",
    `with the payer's wallet row held FOR UPDATE from a separate session, a real wallet payment stalled ${stalled}ms ` +
      `and finished with HTTP ${payStatus}; ${waiterCount} session(s) were waiting on a lock while it was held. ` +
      `Zero waiters would mean the lock blocks nothing and every concurrency result below would be describing ` +
      `requests that never actually competed.`,
  );

  const after = await moneyFor(created.bookingId, fx.userId);
  record(
    "G4",
    "the blocked-then-released payment produced exactly one debit",
    after.walletTxns.length === 1 && after.journals.length === 1 ? "PASS" : "FAIL",
    `${describeMoney(after)}. A payment that waited on a lock must still move money once.`,
  );
}

// ── §5 HEALTHY FINANCIAL BASELINE ─────────────────────────────────────────────────────────────────

async function testHealthyBaselines(): Promise<void> {
  console.log("\n── §5 · two independent healthy financial baselines ───");
  if (!server) await boot("base");
  const fx = await ensureFixtures();
  if (!fx) return;

  for (const run of [1, 2]) {
    const before = await ledgerSnapshot();
    const startPaise = 10_000_000;
    await setWalletPaise(fx.userId, startPaise);
    const b = await createBooking(fx, `base${run}`);
    if (!b.bookingId) {
      record(`B${run}`, `healthy baseline ${run}`, "NOT_PROVEN", `create returned HTTP ${b.status}`);
      continue;
    }
    const status = await payWallet(fx, b.bookingId);
    const m = await moneyFor(b.bookingId, fx.userId);
    const after = await ledgerSnapshot();

    const amountPaise = m.walletTxns.length === 1 ? Number(m.walletTxns[0]!.amount_paise) : -1;
    const expectedEnd = startPaise - amountPaise;
    const journalBalanced = m.journals.length === 1 && Math.abs(m.journals[0]!.debit - m.journals[0]!.credit) < 0.005;
    const ok =
      status === 200 &&
      m.walletTxns.length === 1 &&
      m.journals.length === 1 &&
      journalBalanced &&
      m.balancePaise === expectedEnd &&
      snapshotViolations(after).length === 0;

    record(
      `B${run}`,
      `healthy baseline ${run}: one debit, one balanced journal, exact paise arithmetic`,
      ok ? "PASS" : "FAIL",
      `pay → HTTP ${status}; start=${startPaise}p amount=${amountPaise}p end=${m.balancePaise}p (expected ${expectedEnd}p); ` +
        `${describeMoney(m)}; idempotency keys: txn=${m.walletTxns[0]?.idempotency_key ?? "none"} ` +
        `journal=${m.journals[0]?.idempotency_key ?? "none"}. ` +
        `whole ledger journals ${before.journals} → ${after.journals}, lines ${before.lines} → ${after.lines}, ` +
        `unbalanced ${before.unbalanced} → ${after.unbalanced}`,
    );
  }
}

// ── §6 CONCURRENT PAYMENT CHAOS ───────────────────────────────────────────────────────────────────

async function testConcurrentPayments(): Promise<void> {
  console.log("\n── §6 · concurrent identical payments, 2 → 32 ─────────");
  if (!server) await boot("conc");
  const fx = await ensureFixtures();
  if (!fx) return;

  for (const n of [2, 4, 8, 16, 32]) {
    const startPaise = 10_000_000;
    await setWalletPaise(fx.userId, startPaise);
    const b = await createBooking(fx, `conc${n}`);
    if (!b.bookingId) {
      record(`P${n}`, `${n} concurrent identical payments`, "NOT_PROVEN", `create returned HTTP ${b.status}`);
      continue;
    }
    const statuses = await Promise.all(Array.from({ length: n }, () => payWallet(fx, b.bookingId!)));
    const m = await moneyFor(b.bookingId, fx.userId);
    const snap = await ledgerSnapshot();
    const violations = snapshotViolations(snap);

    const amountPaise = m.walletTxns.length >= 1 ? Number(m.walletTxns[0]!.amount_paise) : 0;
    const expectedEnd = startPaise - amountPaise;
    const ok =
      m.walletTxns.length === 1 &&
      m.journals.length === 1 &&
      m.balancePaise === expectedEnd &&
      violations.length === 0;

    record(
      `P${n}`,
      `${n} CONCURRENT IDENTICAL PAYMENTS MOVE MONEY EXACTLY ONCE`,
      ok ? "PASS" : "FAIL",
      `statuses: [${statuses.join(",")}]; ${describeMoney(m)}; ` +
        `balance ${startPaise}p → ${m.balancePaise}p (expected ${expectedEnd}p after one debit of ${amountPaise}p)` +
        `${violations.length ? ` · VIOLATIONS: ${violations.join("; ")}` : ""}. ` +
        `The arbiters are UNIQUE wallet_transactions.idempotency_key and UNIQUE journal_entries.idempotency_key, ` +
        `under a Serializable transaction that takes the payer's row FOR UPDATE.`,
    );
  }
}

// ── §7 DOUBLE-SPEND ───────────────────────────────────────────────────────────────────────────────

async function testDoubleSpend(): Promise<void> {
  console.log("\n── §7 · double-spend against a finite balance ─────────");
  if (!server) await boot("spend");
  const fx = await ensureFixtures();
  if (!fx) return;

  // Distinct bookings competing for one balance that cannot cover them all.
  const bookings: string[] = [];
  for (let i = 0; i < 6; i++) {
    const b = await createBooking(fx, `spend${i}`);
    if (b.bookingId) bookings.push(b.bookingId);
  }
  if (bookings.length < 3) {
    record("S1", "double-spend against a finite balance", "NOT_PROVEN", `only ${bookings.length} booking(s) could be created`);
    return;
  }

  // Price one booking, then fund the wallet for strictly fewer than all of them.
  const priceRow = (await prisma.$queryRawUnsafe(
    `SELECT round(final_amount::numeric * 100)::bigint AS p FROM bookings WHERE id = $1`,
    bookings[0],
  )) as Array<{ p: bigint }>;
  const pricePaise = Number(priceRow[0]?.p ?? 0n);
  const affordable = 2;
  const startPaise = pricePaise * affordable;
  await setWalletPaise(fx.userId, startPaise);

  const statuses = await Promise.all(bookings.map((id) => payWallet(fx, id)));
  const endPaise = await walletPaise(fx.userId);

  const debits = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n, coalesce(sum(amount_paise), 0)::text AS s
       FROM wallet_transactions
      WHERE user_id = $1 AND reference_id = ANY($2::text[]) AND status = 'COMPLETED' AND type = 'DEBIT'`,
    fx.userId,
    bookings,
  )) as Array<{ n: number; s: string }>;
  const debitCount = debits[0]?.n ?? 0;
  const debitSum = Number(debits[0]?.s ?? "0");

  const snap = await ledgerSnapshot();
  const violations = snapshotViolations(snap);
  const conserved = endPaise === startPaise - debitSum;
  const withinFunds = debitSum <= startPaise;

  record(
    "S1",
    "NO DOUBLE-SPEND — concurrent spends never exceed the available balance",
    withinFunds && endPaise >= 0 && violations.length === 0 ? "PASS" : "FAIL",
    `${bookings.length} distinct bookings of ${pricePaise}p each were paid concurrently from a wallet funded for exactly ` +
      `${affordable} of them (${startPaise}p). HTTP: [${statuses.join(",")}]; ` +
      `successful debits=${debitCount} totalling ${debitSum}p; final balance=${endPaise}p. ` +
      `Spending beyond ${startPaise}p would be money created from nothing` +
      `${violations.length ? ` · VIOLATIONS: ${violations.join("; ")}` : ""}.`,
  );

  record(
    "S2",
    "the arithmetic closes exactly — rejected spends mutated nothing",
    conserved ? "PASS" : "FAIL",
    `start ${startPaise}p − debits ${debitSum}p = ${startPaise - debitSum}p; actual final balance ${endPaise}p. ` +
      `A rejected payment must leave no wallet transaction, no journal and no balance movement, so any drift here ` +
      `is a partial mutation by a request that was refused.`,
  );

  record(
    "S3",
    "the non-negative balance guard held",
    endPaise >= 0 && snap.negativeBalances === 0 ? "PASS" : "FAIL",
    `final balance=${endPaise}p; negative wallet balances across all users=${snap.negativeBalances}. ` +
      `This is enforced in the database by CHECK (wallet_balance_paise >= 0) on users, so a breach would mean the ` +
      `constraint was bypassed rather than merely that the application miscalculated.`,
  );
}
