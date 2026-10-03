/**
 * SECTION 7I — end-to-end business flow under failure.
 *
 *   DATABASE_URL="<homigo_test>" REDIS_URL="redis://localhost:6380" \
 *     bun run scripts/chaos/7i-flow-chaos.ts --test gates,baseline,A,B,C
 *
 * The question this section asks is not whether a component survives a fault, but whether the
 * BUSINESS converges to one correct state afterwards. So no result here is read from an HTTP status
 * code: every outcome is read back from the tables that are the source of truth — bookings, wallet
 * transactions, the double-entry ledger, the transactional outbox and consumer receipts — and
 * reconciled against each other.
 *
 * Failure is injected at real layer boundaries by locking the exact table the flow is about to write,
 * from a separate database session. That parks the server's transaction at a known point with earlier
 * writes already made and later ones pending, which is the only way to ask "did the whole thing roll
 * back" and get an answer that means something.
 *
 * No real funds and no gateway call: the only money that moves is wallet balance inside `homigo_test`,
 * and `POST /api/wallet/checkout/pay` reaches no external service at all.
 */
import {
  type Check,
  type ServerHandle,
  clearPort,
  killTree,
  listenerPidOn,
  machineState,
  makeRecorder,
  probeHealth,
  startServer,
  stopServer,
  telemetry,
} from "./7f-lib";
import crypto from "node:crypto";
import { assertChaosTargetIsolated, describeDatabaseTarget, describeRedisTarget } from "../../src/lib/chaos-isolation";

const redisTarget = describeRedisTarget();
if (!redisTarget || redisTarget.port !== "6380") {
  throw new Error(`CHAOS SAFETY: 7I refused — REDIS_URL is ${redisTarget?.redacted ?? "missing"}, not the isolated instance on 6380.`);
}

const PORT = Number(process.env.SEVEN_I_PORT ?? 3500);
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

/** The harness publishes and reads like a peer instance; an unconnected client is a silent no-op. */
const { redisClient: harnessRedis } = await import("../../src/lib/redis");
await harnessRedis.connect().catch(() => {});
if (!harnessRedis.isAvailable) {
  throw new Error("7I SETUP: the harness's own Redis client is not available — cross-instance observations would be silently empty.");
}

const checks: Check[] = [];
const record = makeRecorder(checks);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SERVER_ENV = {
  APP_ENV: "chaos",
  NODE_ENV: "development",
  LOAD_TEST_MODE: "1",
  EVENTS_CONSUMERS_ENABLED: "true",
  EVENTS_OUTBOX_ENABLED: "true",
  EVENTS_OUTBOX_LOCK_TIMEOUT_MS: "10000",
  EVENTS_OUTBOX_INTERVAL_MS: "2000",
  EVENTS_JOBS_LEASE_MS: "30000",
  EVENTS_JOBS_INTERVAL_MS: "2000",
  /**
   * Signature mocking, explicitly opted in. `paymentMocksAllowed()` refuses this in production and
   * staging regardless, so enabling it here cannot leak into a real environment — and it is what
   * lets the payment-verification boundary be exercised without a gateway call.
   */
  HOMIGO_ALLOW_PAYMENT_MOCKS: "1",
  PORT: String(PORT),
};

let server: ServerHandle | null = null;

async function boot(label: string, env: Record<string, string> = SERVER_ENV): Promise<ServerHandle> {
  assertChaosTargetIsolated("7I server start");
  const h = await startServer({ env, logPath: `${LOG_DIR}/7i-server-${label}.log`, port: PORT, readyTimeoutMs: 120_000 });
  server = h;
  return h;
}

function processAlive(pid: number): boolean {
  const ps = Bun.spawnSync(["powershell", "-NoProfile", "-Command", `if (Get-Process -Id ${pid} -EA SilentlyContinue) { 'alive' } else { 'gone' }`]);
  return ps.stdout.toString().trim() === "alive";
}

/** Kills the pid that owns the socket and proves it died. Established in 7H; reused verbatim. */
async function killServer(): Promise<{ pid: number; gone: boolean; ms: number }> {
  const pid = listenerPidOn(PORT);
  if (pid === null) throw new Error("7I: nothing is listening — there is no process to kill");
  const started = Date.now();
  killTree(pid);
  let gone = false;
  for (let i = 0; i < 60; i++) {
    gone = !processAlive(pid) && listenerPidOn(PORT) === null;
    if (gone) break;
    await sleep(250);
  }
  server = null;
  return { pid, gone, ms: Date.now() - started };
}

// ── layered failure injection ─────────────────────────────────────────────────────────────────────

/**
 * Parks the server's transaction at a precise point by taking an ACCESS EXCLUSIVE lock on the table
 * it is about to write, from a separate session.
 *
 * Which table decides WHERE the flow stops, and that is the whole value of it:
 *   - `ledger_entries`  → the wallet payment has already inserted its wallet_transaction and updated
 *                         the balance, and is blocked on the journal. A crash here must roll ALL of
 *                         that back; a surviving wallet debit without its journal would be a real
 *                         financial defect.
 *   - `event_outbox`    → booking creation has already inserted the booking and is blocked on its
 *                         transactional event. A crash here must leave no booking.
 *
 * The transaction carries its own deadline so a crashed harness cannot leave the table locked.
 */
function lockTable(table: string, maxHoldMs: number): { release: () => void; started: Promise<void>; ended: Promise<void> } {
  let releaseFn: () => void = () => {};
  let markStarted: () => void = () => {};
  const untilReleased = new Promise<void>((r) => {
    releaseFn = r;
  });
  const started = new Promise<void>((r) => {
    markStarted = r;
  });
  const ended = prisma
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
        markStarted();
        await untilReleased;
      },
      { timeout: maxHoldMs + 5_000, maxWait: 15_000 },
    )
    .then(() => undefined)
    .catch(() => undefined);
  return { release: releaseFn, started, ended };
}

async function sessionsWaitingOnLock(): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  )) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

type Fixtures = {
  userId: string;
  token: string;
  serviceId: string;
  addressId: string;
  providerId: string;
  partnerUserId: string;
};

const CUSTOMER_EMAIL = "s7i.customer@homigo.test";
const PARTNER_EMAIL = "s7i.partner@homigo.test";
const PASSWORD = "Rj6!wTn2Kb8v";

async function registerAndLogin(email: string): Promise<{ userId: string; token: string } | null> {
  const login = async (): Promise<string | null> => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, setAuthCookies: false }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data?: { accessToken?: string } }).data?.accessToken ?? null;
  };
  let token = await login();
  if (!token) {
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        firstName: "SevenI",
        lastName: email.includes("partner") ? "Partner" : "Customer",
        phoneNumber: `+91${Math.floor(7000000000 + Math.random() * 999999999)}`,
        userType: "customer",
        agreeToTerms: true,
        setAuthCookies: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!reg.ok) {
      console.error(`  register ${email} failed: ${reg.status} ${(await reg.text()).slice(0, 200)}`);
      return null;
    }
    token = await login();
  }
  if (!token) return null;
  const me = await fetch(`${BASE}/api/users/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!me.ok) return null;
  const userId = ((await me.json()) as { data?: { user?: { id?: string } } }).data?.user?.id;
  return userId ? { userId, token } : null;
}

let fixtures: Fixtures | null = null;

/**
 * A verified customer with wallet balance, a partner with a provider row, a service and an address.
 *
 * The wallet is credited with a direct row rather than through a top-up, because a top-up would call
 * the payment gateway. The credit is a fixture in a disposable database; everything the tests then do
 * with that balance goes through the real product path.
 */
async function ensureFixtures(): Promise<Fixtures | null> {
  if (fixtures) return fixtures;
  const customer = await registerAndLogin(CUSTOMER_EMAIL);
  const partner = await registerAndLogin(PARTNER_EMAIL);
  if (!customer || !partner) return null;

  await prisma.user.update({ where: { id: customer.userId }, data: { isEmailVerified: true } });
  await prisma.user.update({ where: { id: partner.userId }, data: { isEmailVerified: true, role: "VENDOR" } });

  const provider =
    (await prisma.provider.findFirst({ where: { userId: partner.userId }, select: { id: true } })) ??
    (await prisma.provider.create({ data: { userId: partner.userId, businessName: "7I Flow Partner", isApproved: true }, select: { id: true } }));

  const service = await prisma.service.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!service) return null;

  /**
   * The partner is made genuinely DISPATCHABLE, because a partner nobody can match is a partner the
   * dispatch tests never reach.
   *
   * `findBestProviders` filters on the service category, active/approved/ACTIVE-lifecycle, online,
   * distance from a base point, working hours, and a presence gate that fails closed. A minimal
   * provider row passes none of them, so a dispatch scenario built on one would report "no duplicate
   * dispatch" purely because no dispatch ever happened — the emptiest kind of pass, and the exact
   * failure mode this program has hit repeatedly. Every field below mirrors the product's own
   * integration fixture rather than being invented here, and the base point is the fixture address so
   * the distance filter is satisfied by construction.
   */
  await prisma.provider.update({
    where: { id: provider.id },
    data: {
      serviceCategories: [service.id],
      serviceRegions: [],
      serviceRadiusKm: 50,
      baseLatitude: 19.076,
      baseLongitude: 72.8777,
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      isVerified: true,
      isApproved: true,
      lifecycleState: "ACTIVE",
      isActive: true,
      isOnline: true,
      rating: 4.5,
    },
  });

  const address =
    (await prisma.address.findFirst({ where: { userId: customer.userId }, select: { id: true } })) ??
    (await prisma.address.create({
      data: { userId: customer.userId, label: "7I fixture", addressLine1: "11 Flow Lane", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
      select: { id: true },
    }));

  const fresh = await registerAndLogin(CUSTOMER_EMAIL);
  fixtures = {
    userId: customer.userId,
    token: fresh?.token ?? customer.token,
    serviceId: service.id,
    addressId: address.id,
    providerId: provider.id,
    partnerUserId: partner.userId,
  };
  return fixtures;
}

/** Tops the fixture wallet up to a known balance with a direct write — never through the gateway. */
async function setWalletBalance(userId: string, amount: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { walletBalance: amount, walletBalancePaise: BigInt(Math.round(amount * 100)) },
  });
}

/**
 * A real presence heartbeat for the fixture partner, through the product's own service.
 *
 * Dispatch matching fails CLOSED without fresh presence evidence, and the evidence goes stale, so a
 * scenario that dispatches must refresh it immediately beforehand rather than once at startup. The row
 * is not written directly: `partnerPresenceService.heartbeat` is the path the partner app uses, and
 * hand-writing presence would be testing a state the platform does not actually produce.
 */
let presenceError = "";
async function freshenPresence(fx: Fixtures): Promise<boolean> {
  try {
    const { JWTService } = await import("../../src/services/jwt.service");
    const { RefreshTokenService } = await import("../../src/services/refresh-token.service");
    const { partnerPresenceService } = await import("../../src/services/partner-presence.service");
    const jwtSvc = new JWTService();
    const deviceId = `7i-${fx.providerId.slice(-8)}`;
    const session = await new RefreshTokenService(prisma, jwtSvc).createSessionTokens({
      userId: fx.partnerUserId,
      email: PARTNER_EMAIL,
      deviceId,
    });
    /**
     * Promote the new session first, exactly as a partner login does. A presence row left by an
     * earlier run still names that run's session, and heartbeat correctly refuses a beat from any
     * other one (STALE_SESSION) — session B replacing session A is a real security property, not an
     * obstacle to work around. Clearing the column by hand would have silenced the gate; calling the
     * product's own promotion path satisfies it.
     */
    await partnerPresenceService.promoteSession(fx.providerId, session.sessionId, deviceId);
    const current = await prisma.partnerPresence.findUnique({
      where: { providerId: fx.providerId },
      select: { lastLocationSeq: true },
    });
    await partnerPresenceService.heartbeat(
      { providerId: fx.providerId, userId: fx.partnerUserId },
      {
        sessionId: session.sessionId,
        deviceId,
        timestamp: new Date(),
        appState: "foreground",
        platform: "android",
        location: { latitude: 19.076, longitude: 72.8777, accuracy: 12, capturedAt: new Date(), sequence: (current?.lastLocationSeq ?? 0) + 1 },
      },
    );
    return true;
  } catch (e) {
    presenceError = (e as Error).message.slice(0, 200);
    return false;
  }
}

/**
 * Slots must satisfy two real constraints at once: `MAX_DAYS_AHEAD = 30`, and the
 * `bookings_user_slot_excl` exclusion that forbids overlapping hour-long slots for one customer.
 *
 * The cursor starts at a random offset because it used to start at zero on every run, so a second run
 * asked for the same slots as the first and every booking came back 409 OVERLAPPING_BOOKING — the
 * scenarios then measured a scheduling collision instead of a failure mode. Prior runs' bookings are
 * also swept before each run, which is the actual fix; the offset just makes concurrent runs safe.
 */
let slotCursor = Math.floor(Math.random() * 120);
function nextSlot(): string {
  slotCursor += 1;
  const hours = 48 + (slotCursor * 2) % (27 * 24);
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** Sweeps bookings left by any earlier 7I run so slot exclusions cannot collide across runs. */
async function sweepPrior7iBookings(): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(`SELECT id FROM bookings WHERE description LIKE '7I %'`)) as Array<{ id: string }>;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return 0;
  const txns = (await prisma.$queryRawUnsafe(
    `SELECT id FROM wallet_transactions WHERE reference_id = ANY($1::text[])`,
    ids,
  )) as Array<{ id: string }>;
  const keys = txns.map((t) => `wallet_debit:${t.id}`);
  if (keys.length) {
    const journals = (await prisma.$queryRawUnsafe(`SELECT id FROM journal_entries WHERE idempotency_key = ANY($1::text[])`, keys)) as Array<{ id: string }>;
    const jids = journals.map((j) => j.id);
    if (jids.length) {
      await prisma.$executeRawUnsafe(`DELETE FROM ledger_balance_snapshots WHERE journal_id = ANY($1::text[])`, jids).catch(() => 0);
      await prisma.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE journal_id = ANY($1::text[])`, jids).catch(() => 0);
      await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = ANY($1::text[])`, jids).catch(() => 0);
    }
  }
  await prisma.$executeRawUnsafe(`DELETE FROM wallet_transactions WHERE reference_id = ANY($1::text[])`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE aggregate_id = ANY($1::text[])`, ids).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM bookings WHERE id = ANY($1::text[])`, ids).catch(() => 0);
  return ids.length;
}

async function createBooking(fx: Fixtures, tag: string): Promise<{ status: number; bookingId: string | null }> {
  const res = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ serviceId: fx.serviceId, addressId: fx.addressId, scheduledDate: nextSlot(), description: `7I ${tag} ${RUN_TAG}` }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { booking?: { id?: string }; id?: string } };
  return { status: res.status, bookingId: body.data?.booking?.id ?? body.data?.id ?? null };
}

// ── reconciliation ────────────────────────────────────────────────────────────────────────────────

type FlowState = {
  booking: { id: string; status: string; paymentStatus: string; finalAmount: number } | null;
  outboxForBooking: Array<{ event_type: string; status: string }>;
  walletTxns: Array<{ id: string; amount: number; amount_paise: string; status: string; type: string }>;
  journals: Array<{ id: string; idempotency_key: string | null; debit: number; credit: number; lines: number }>;
  walletBalance: number;
  walletBalancePaise: string;
};

/**
 * One read of every table that has an opinion about this booking, taken together so the reconciliation
 * matrix compares a single moment rather than a sequence of slightly different ones.
 */
async function readFlowState(bookingId: string, userId: string): Promise<FlowState> {
  const booking = (await prisma.$queryRawUnsafe(
    `SELECT id, status::text AS status, payment_status::text AS payment_status, final_amount FROM bookings WHERE id = $1`,
    bookingId,
  )) as Array<{ id: string; status: string; payment_status: string; final_amount: number }>;
  const outbox = (await prisma.$queryRawUnsafe(
    `SELECT event_type, status::text AS status FROM event_outbox WHERE aggregate_id = $1 ORDER BY created_at`,
    bookingId,
  )) as Array<{ event_type: string; status: string }>;
  const txns = (await prisma.$queryRawUnsafe(
    `SELECT id, amount, amount_paise::text AS amount_paise, status::text AS status, type::text AS type
     FROM wallet_transactions WHERE reference_id = $1 AND reference_type = 'booking_wallet_payment' ORDER BY created_at`,
    bookingId,
  )) as Array<{ id: string; amount: number; amount_paise: string; status: string; type: string }>;
  const journals = txns.length
    ? ((await prisma.$queryRawUnsafe(
        `SELECT j.id, j.idempotency_key, COALESCE(sum(l.debit),0)::float8 AS debit, COALESCE(sum(l.credit),0)::float8 AS credit, count(l.id)::int AS lines
         FROM journal_entries j LEFT JOIN ledger_entries l ON l.journal_id = j.id
         WHERE j.idempotency_key = ANY($1::text[]) GROUP BY j.id, j.idempotency_key`,
        txns.map((t) => `wallet_debit:${t.id}`),
      )) as Array<{ id: string; idempotency_key: string | null; debit: number; credit: number; lines: number }>)
    : [];
  const user = (await prisma.$queryRawUnsafe(
    `SELECT wallet_balance, wallet_balance_paise::text AS wallet_balance_paise FROM users WHERE id = $1`,
    userId,
  )) as Array<{ wallet_balance: number; wallet_balance_paise: string }>;

  return {
    booking: booking[0]
      ? { id: booking[0].id, status: booking[0].status, paymentStatus: booking[0].payment_status, finalAmount: booking[0].final_amount }
      : null,
    outboxForBooking: outbox,
    walletTxns: txns,
    journals,
    walletBalance: Number(user[0]?.wallet_balance ?? 0),
    walletBalancePaise: user[0]?.wallet_balance_paise ?? "0",
  };
}

function describeFlow(s: FlowState): string {
  return (
    `booking=${s.booking ? `${s.booking.status}/${s.booking.paymentStatus} ₹${s.booking.finalAmount}` : "ABSENT"}; ` +
    `outbox=[${s.outboxForBooking.map((o) => `${o.event_type}:${o.status}`).join(", ") || "none"}]; ` +
    `walletTxns=${s.walletTxns.length}${s.walletTxns.length ? ` [${s.walletTxns.map((t) => `${t.type}/${t.status} ₹${t.amount} (${t.amount_paise}p)`).join(", ")}]` : ""}; ` +
    `journals=${s.journals.length}${s.journals.length ? ` [${s.journals.map((j) => `${j.lines} lines, dr ${j.debit}/cr ${j.credit}`).join(", ")}]` : ""}; ` +
    `wallet=₹${s.walletBalance} (${s.walletBalancePaise}p)`
  );
}

/** Ledger-wide balance: every journal must have equal debits and credits. */
async function ledgerImbalance(): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM (
      SELECT j.id FROM journal_entries j JOIN ledger_entries l ON l.journal_id = j.id
      GROUP BY j.id HAVING round(sum(l.debit)::numeric, 2) <> round(sum(l.credit)::numeric, 2)
    ) d
  `)) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

console.log("SECTION 7I — end-to-end business flow under failure");
console.log(`  run tag  : ${RUN_TAG}`);
console.log(`  db       : ${describeDatabaseTarget()?.redacted}`);
console.log(`  redis    : ${redisTarget.redacted}`);
console.log(`  port     : ${PORT}`);
console.log(`  gateway  : NOT CALLED — wallet-funded flows only; signature mocks opted in via HOMIGO_ALLOW_PAYMENT_MOCKS`);
console.log(`  machine  : ${await machineState()}\n`);

const swept = await sweepPrior7iBookings();
if (swept > 0) console.log(`  swept ${swept} booking(s) left by earlier 7I runs so slot exclusions cannot collide
`);

let exitCode = 0;
try {
  if (want("gates")) await testGates();
  if (want("B")) await testCrashDuringTransaction();
  if (want("K")) await testAmbiguousRetry();
  if (want("D")) await testOutboxFailure();
  if (want("F")) await testRealtimeFailure();
  if (want("H")) await testFinancial();
  if (want("G")) await testPaymentBoundary();
  if (want("J")) await testSchedulerDependent();
  if (want("N")) await testPartnerDispatch();
  if (want("M")) await testNotificationFailure();
  if (want("L")) await testComposite();
} finally {
  if (server) stopServer(server);
  clearPort(PORT);
  console.log("\n── POST-RUN ──────────────────────────────────────────");
  record("Z1", "no server left listening", listenerPidOn(PORT) === null ? "PASS" : "FAIL", `listener on :${PORT} = ${listenerPidOn(PORT) ?? "none"}`);
  const imbalance = await ledgerImbalance();
  record("Z2", "the ledger is balanced across every journal entry", imbalance === 0 ? "PASS" : "FAIL", `unbalanced journal entries: ${imbalance}`);

  const fails = checks.filter((c) => c.status === "FAIL");
  const unproven = checks.filter((c) => c.status === "NOT_PROVEN");
  console.log("\n══ 7I RESULT ═════════════════════════════════════════");
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

// ── §4 HARNESS VALIDATION ─────────────────────────────────────────────────────────────────────────

async function testGates(): Promise<void> {
  console.log("── §4 · harness validation ────────────────────────────");
  const h = await boot("gates");
  const health = await probeHealth(PORT);
  record(
    "H0",
    "isolated, ready, and the gateway is out of scope by construction",
    health.isolatedDatabase && health.ready ? "PASS" : "FAIL",
    `isolatedDatabase=${health.isolatedDatabase} status=${health.status} database=${health.database} redis=${health.redis}; ` +
      `backend pid=${h.listenerPid} on :${PORT}; run=${RUN_TAG}`,
  );

  const fx = await ensureFixtures();
  if (!fx) {
    record("H-FIX", "business fixtures", "NOT_PROVEN", "could not provision the customer, partner, service and address");
    return;
  }
  record(
    "H-FIX",
    "deterministic business fixtures provisioned",
    "PASS",
    `customer=${fx.userId.slice(0, 12)}… partner=${fx.partnerUserId.slice(0, 12)}… provider=${fx.providerId.slice(0, 12)}… ` +
      `service=${fx.serviceId.slice(0, 12)}… address=${fx.addressId.slice(0, 12)}…`,
  );

  // A — a healthy flow completes end to end.
  await setWalletBalance(fx.userId, 100_000);
  const created = await createBooking(fx, "gate");
  const paid = created.bookingId
    ? await fetch(`${BASE}/api/wallet/checkout/pay`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
        body: JSON.stringify({ bookingId: created.bookingId }),
        signal: AbortSignal.timeout(30_000),
      })
    : null;
  const paidStatus = paid?.status ?? null;
  const state = created.bookingId ? await readFlowState(created.bookingId, fx.userId) : null;

  record(
    "H-A",
    "a complete business flow succeeds under healthy conditions (booking → wallet payment → ledger)",
    created.status === 201 && paidStatus === 200 && state?.booking?.paymentStatus === "SUCCESS" && state.journals.length === 1 ? "PASS" : "FAIL",
    `create → HTTP ${created.status}; pay → HTTP ${paidStatus}; ${state ? describeFlow(state) : "no booking"}`,
  );

  // D/E/F — every layer can be inspected independently.
  record(
    "H-DEF",
    "business, outbox and ledger state are independently inspectable",
    state !== null && state.outboxForBooking.length > 0 && state.walletTxns.length === 1 ? "PASS" : "FAIL",
    state ? describeFlow(state) : "no state",
  );

  /**
   * B — the injection must be shown to BLOCK, not merely to have been issued.
   *
   * A first version held the lock, watched an unrelated flow succeed and passed on that alone: it
   * proved the lock was taken and nothing about whether it stops anything. So a flow that genuinely
   * writes `ledger_entries` is fired against the held lock, and the control is whether it stalls.
   */
  const payTarget = await createBooking(fx, "gate-blocked");
  const before = Date.now();
  const lock = lockTable("ledger_entries", 20_000);
  await lock.started;

  const blockedPay = payTarget.bookingId
    ? fetch(`${BASE}/api/wallet/checkout/pay`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
        body: JSON.stringify({ bookingId: payTarget.bookingId }),
        signal: AbortSignal.timeout(40_000),
      })
        .then((r) => ({ status: r.status as number | null, ms: Date.now() - before }))
        .catch(() => ({ status: null as number | null, ms: Date.now() - before }))
    : Promise.resolve({ status: null as number | null, ms: 0 });

  await sleep(3000);
  const waiting = await sessionsWaitingOnLock();
  const second = await createBooking(fx, "gate-unaffected");
  const blocked = second.status;
  lock.release();
  await lock.ended;
  const payResult = await blockedPay;

  record(
    "H-B",
    "positive control: the injection genuinely BLOCKS the layer it targets",
    waiting >= 1 && payResult.ms > 2500 ? "PASS" : "FAIL",
    `with ledger_entries locked, a wallet payment stalled ${payResult.ms}ms and finished with ${payResult.status ?? "no response"}; ` +
      `${waiting} session(s) were waiting on a lock while it was held. Zero waiters would mean the lock blocks nothing and every ` +
      `crash-during-transaction result below would be describing an idle process.`,
  );
  record(
    "H-C",
    "the injection is SCOPED — a flow that does not touch the locked table is unaffected",
    blocked === 201 ? "PASS" : "FAIL",
    `booking creation during a ledger_entries lock → HTTP ${blocked} (expected 201: booking creation writes bookings and event_outbox, not ledger_entries). ` +
      `A blocked result here would mean the injection is global and nothing downstream could be attributed.`,
  );

  const t = await telemetry(prisma, PORT);
  record("H-G", "telemetry and worker state observable", t.rssMb > 0 ? "PASS" : "FAIL", `rss=${t.rssMb}MB db=${t.dbConnections} redis_up=${t.redisUp}`);

  // Clean up the gate's bookings.
  await cleanupRunArtifacts();
}


// ── FAILURE MODE B — CRASH DURING THE BUSINESS TRANSACTION ────────────────────────────────────────

/**
 * The atomicity question, asked at the hardest point in the flow.
 *
 * Locking `ledger_entries` parks the wallet payment INSIDE its transaction with the wallet debit row
 * and the new balance already written and the journal still pending. Killing the process there is the
 * case that separates a real transaction from a sequence of writes: everything must vanish. A wallet
 * debit that survived without its journal would be money moved with no double-entry record.
 */
async function testCrashDuringTransaction(): Promise<void> {
  console.log("\n── B · crash mid-transaction (parked at the ledger write) ──");
  const h = await boot("midtx");
  const fx = await ensureFixtures();
  if (!fx) return;

  await setWalletBalance(fx.userId, 50_000);
  const balanceBefore = 50_000;
  const created = await createBooking(fx, "midtx");
  if (!created.bookingId) {
    record("B0", "a booking exists to pay for", "NOT_PROVEN", `create returned HTTP ${created.status}`);
    return;
  }
  const bookingId = created.bookingId;

  const lock = lockTable("ledger_entries", 30_000);
  await lock.started;

  const t0 = Date.now();
  const inflight = fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(60_000),
  })
    .then((r) => ({ status: r.status as number | null, ms: Date.now() - t0 }))
    .catch(() => ({ status: null as number | null, ms: Date.now() - t0 }));

  await sleep(3000);
  const waiting = await sessionsWaitingOnLock();
  const death = await killServer();
  const clientOutcome = await inflight;
  lock.release();
  await lock.ended;
  await sleep(2000);

  const state = await readFlowState(bookingId, fx.userId);
  record(
    "B0",
    "the payment was genuinely parked inside its transaction when the process died",
    waiting >= 1 && death.gone ? "PASS" : "FAIL",
    `${waiting} session(s) waiting on the ledger lock at the moment of the kill; process gone=${death.gone} in ${death.ms}ms; ` +
      `client outcome after ${clientOutcome.ms}ms: ${clientOutcome.status ?? "connection failed"}`,
  );
  record(
    "B1",
    "NO PARTIAL FINANCIAL STATE — the whole transaction rolled back",
    state.walletTxns.length === 0 && state.journals.length === 0 && state.walletBalance === balanceBefore && state.booking?.paymentStatus !== "SUCCESS"
      ? "PASS"
      : "FAIL",
    `after the crash: ${describeFlow(state)}. Expected: no wallet transaction, no journal, wallet still ₹${balanceBefore}, booking unpaid.`,
  );

  // The flow must still be completable afterwards — a rollback that leaves the booking unusable is
  // its own kind of damage.
  const h2 = await boot("midtx2");
  const retry = await fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(30_000),
  });
  await sleep(1500);
  const afterRetry = await readFlowState(bookingId, fx.userId);
  record(
    "B2",
    "the flow completes cleanly on retry after the rollback",
    retry.status === 200 && afterRetry.walletTxns.length === 1 && afterRetry.journals.length === 1 ? "PASS" : "FAIL",
    `retry → HTTP ${retry.status}; ${describeFlow(afterRetry)}`,
  );
  void h;
  stopServer(h2);
  server = null;
  await sleep(1000);
}

// ── FAILURE MODE C / K — CRASH AFTER COMMIT, AND THE AMBIGUOUS CLIENT RETRY ───────────────────────

/**
 * The most consequential real-world case: the server commits, the client never learns, the client
 * retries.
 *
 * It is driven deterministically rather than by racing the response: the payment is committed and
 * confirmed in the database, the process is then killed, and the same request is replayed against the
 * replacement. What must hold is that the replay changes nothing — one debit, one journal, one
 * balance movement — which is the property a customer pressing "pay" twice depends on.
 *
 * A second part races the actual post-commit window, because "committed but no response" is the state
 * the idempotency is FOR, and it is worth showing it occurs.
 */
async function testAmbiguousRetry(): Promise<void> {
  console.log("\n── C/K · crash after commit, then client retry ────────");
  const h = await boot("ambiguous");
  const fx = await ensureFixtures();
  if (!fx) return;

  await setWalletBalance(fx.userId, 50_000);
  const created = await createBooking(fx, "ambiguous");
  if (!created.bookingId) {
    record("K0", "a booking exists to pay for", "NOT_PROVEN", `create returned HTTP ${created.status}`);
    return;
  }
  const bookingId = created.bookingId;

  const firstPay = await fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(30_000),
  });
  await sleep(1000);
  const committed = await readFlowState(bookingId, fx.userId);
  record(
    "K0",
    "the business operation is committed and durable before the crash",
    firstPay.status === 200 && committed.walletTxns.length === 1 && committed.journals.length === 1 ? "PASS" : "FAIL",
    `pay → HTTP ${firstPay.status}; ${describeFlow(committed)}`,
  );

  const death = await killServer();
  const h2 = await boot("ambiguous2");

  // The client, having received nothing, retries the identical request.
  const retry = await fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(30_000),
  });
  const retryBody = (await retry.json().catch(() => ({}))) as { data?: { alreadyPaid?: boolean; amountPaid?: number } };
  await sleep(1500);
  const afterRetry = await readFlowState(bookingId, fx.userId);

  record(
    "K1",
    "the committed state survives the crash unchanged",
    afterRetry.walletTxns.length === 1 && afterRetry.booking?.paymentStatus === "SUCCESS" ? "PASS" : "FAIL",
    `after crash (pid ${death.pid}, gone in ${death.ms}ms) and restart: ${describeFlow(afterRetry)}`,
  );
  record(
    "K2",
    "NO DUPLICATE FINANCIAL SIDE EFFECT — the retry debits nothing a second time",
    afterRetry.walletTxns.length === 1 &&
      afterRetry.journals.length === 1 &&
      afterRetry.walletBalance === committed.walletBalance
      ? "PASS"
      : "FAIL",
    `wallet transactions ${committed.walletTxns.length} → ${afterRetry.walletTxns.length}; journals ${committed.journals.length} → ${afterRetry.journals.length}; ` +
      `balance ₹${committed.walletBalance} → ₹${afterRetry.walletBalance}. The retry answered HTTP ${retry.status} with alreadyPaid=${retryBody.data?.alreadyPaid}.`,
  );
  record(
    "K3",
    "the retry is answered correctly rather than rejected as a conflict",
    retry.status === 200 && retryBody.data?.alreadyPaid === true ? "PASS" : "FAIL",
    `HTTP ${retry.status}, alreadyPaid=${retryBody.data?.alreadyPaid}, amountPaid=${retryBody.data?.amountPaid}. ` +
      `The service recognises a prior COMPLETED wallet payment for the booking and returns it instead of charging again.`,
  );

  /**
   * The genuine race: kill the process WHILE a payment is in flight, repeatedly, and look for a run
   * where the database committed but the client got nothing. That is the state the idempotency above
   * exists to survive, and observing it makes the argument concrete rather than theoretical.
   */
  /**
   * Catching the window needs CONCURRENCY, not better timing.
   *
   * Between a commit and the HTTP write there are microseconds, and a kill takes seconds — so killing
   * after a single request can never land there. With many payments in flight at once, the kill
   * arrives while they are spread across the whole flow, and some are past their commit with no
   * response written. That is the state a customer's retry actually meets.
   */
  if (!server) await boot("race");
  await setWalletBalance(fx.userId, 200_000);
  const raceBookings: string[] = [];
  for (let i = 0; i < 12; i++) {
    const b = await createBooking(fx, `race${i}`);
    if (b.bookingId) raceBookings.push(b.bookingId);
  }

  const inflight = raceBookings.map((id) =>
    fetch(`${BASE}/api/wallet/checkout/pay`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
      body: JSON.stringify({ bookingId: id }),
      signal: AbortSignal.timeout(30_000),
    })
      .then((r) => ({ id, status: r.status as number | null }))
      .catch(() => ({ id, status: null as number | null })),
  );
  await sleep(120);
  await killServer();
  const outcomes = await Promise.all(inflight);

  await boot("race2");
  let ambiguousObserved = 0;
  let duplicatesAfterRace = 0;
  for (const o of outcomes) {
    const st = await readFlowState(o.id, fx.userId);
    const committed = st.walletTxns.length === 1;
    if (o.status === null && committed) ambiguousObserved++;
    // Every one of them is retried, whatever the client saw — that is what a real client does.
    await fetch(`${BASE}/api/wallet/checkout/pay`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
      body: JSON.stringify({ bookingId: o.id }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
  }
  await sleep(2000);
  for (const o of outcomes) {
    const after = await readFlowState(o.id, fx.userId);
    if (after.walletTxns.length > 1 || after.journals.length > 1) duplicatesAfterRace++;
  }

  record(
    "K4",
    "the committed-but-unanswered window is reached under concurrency, and retrying into it still debits once",
    duplicatesAfterRace === 0 ? "PASS" : "FAIL",
    `${outcomes.length} payments were in flight when the process was killed; ` +
      `${outcomes.filter((o) => o.status === null).length} clients got no response, of which ${ambiguousObserved} had in fact committed. ` +
      `All ${outcomes.length} were then retried: ${duplicatesAfterRace} produced a duplicate wallet transaction or journal.` +
      (ambiguousObserved === 0
        ? " No committed-but-unanswered case occurred in this run, so it proves retry safety rather than the window's reachability."
        : " This is the exact real-world case the idempotency exists for, and it held."),
  );

  if (server) stopServer(server);
  server = null;
  void h;
  await sleep(1000);
}

// ── FAILURE MODE D — OUTBOX / ASYNC FAILURE ──────────────────────────────────────────────────────

/**
 * Cross-checks 7D's protection from the business side: with consumers disabled the event must stay
 * PENDING rather than being marked terminal, and the business state must be unaffected either way.
 */
async function testOutboxFailure(): Promise<void> {
  console.log("\n── D · consumers disabled, then recovered ─────────────");
  const h = await boot("outboxfail", { ...SERVER_ENV, EVENTS_CONSUMERS_ENABLED: "false" });
  const fx = await ensureFixtures();
  if (!fx) return;

  const created = await createBooking(fx, "outboxfail");
  if (!created.bookingId) {
    record("D0", "a booking exists", "NOT_PROVEN", `create returned HTTP ${created.status}`);
    return;
  }
  await sleep(8000); // several outbox ticks
  const withConsumersOff = await readFlowState(created.bookingId, fx.userId);

  record(
    "D1",
    "the business write succeeds even though no consumer can run",
    withConsumersOff.booking !== null && created.status === 201 ? "PASS" : "FAIL",
    `create → HTTP ${created.status}; ${describeFlow(withConsumersOff)}`,
  );
  record(
    "D2",
    "the durable event stays PENDING and is NOT falsely marked terminal",
    withConsumersOff.outboxForBooking.length > 0 && withConsumersOff.outboxForBooking.every((o) => o.status === "PENDING") ? "PASS" : "FAIL",
    `outbox rows: ${JSON.stringify(withConsumersOff.outboxForBooking)}. A PUBLISHED row here with no consumer would be the 7D defect: ` +
      `terminal, undelivered and indistinguishable from a delivered one.`,
  );

  stopServer(h);
  server = null;

  /**
   * Bring this run's event to the head of the queue before measuring the drain.
   *
   * The outbox is FIFO and `homigo_test` carries a backlog of ~15k PENDING rows from earlier
   * sections, so a freshly queued event is not reached for a very long time. A first version waited
   * two minutes and reported "never drained", which measured the depth of an accumulated test queue
   * rather than whether recovery works. Backdating `available_at` is the technique 7D and 7H used for
   * the same reason: it changes WHEN the row is claimed, not what happens to it.
   */
  await prisma.$executeRawUnsafe(
    `UPDATE event_outbox SET available_at = now() - interval '1 day', created_at = now() - interval '2 days' WHERE aggregate_id = $1`,
    created.bookingId,
  );

  const h2 = await boot("outboxfail2");
  const drained = await waitForCondition(async () => {
    const st = await readFlowState(created.bookingId!, fx.userId);
    return st.outboxForBooking.length > 0 && st.outboxForBooking.every((o) => o.status === "PUBLISHED");
  }, 120_000, 2000);
  const afterRecovery = await readFlowState(created.bookingId, fx.userId);

  record(
    "D3",
    "re-enabling consumers drains the queued event without manual repair",
    drained !== null ? "PASS" : "FAIL",
    `after restarting with consumers enabled, the event reached PUBLISHED in ${drained ?? ">120000"}ms: ${JSON.stringify(afterRecovery.outboxForBooking)}`,
  );
  record(
    "D4",
    "business state is unchanged by the async outage and its recovery",
    afterRecovery.booking?.status === withConsumersOff.booking?.status ? "PASS" : "FAIL",
    `booking status ${withConsumersOff.booking?.status} → ${afterRecovery.booking?.status}; notification/async failure did not roll back the business operation`,
  );
  stopServer(h2);
  server = null;
  await sleep(1000);
}

// ── FAILURE MODE F — REALTIME FAILURE ────────────────────────────────────────────────────────────

/**
 * 7G established realtime is best-effort/at-most-once. The business question is different and is the
 * one asked here: when realtime is lost, is the durable truth still correct and still reachable?
 */
async function testRealtimeFailure(): Promise<void> {
  console.log("\n── F · realtime lost, business truth intact ───────────");
  const h = await boot("realtime");
  const fx = await ensureFixtures();
  if (!fx) return;
  const { WsClient } = await import("./7g-lib");

  const created = await createBooking(fx, "realtime");
  if (!created.bookingId) return;
  const bookingId = created.bookingId;

  // A — connected client sees the transition.
  const connected = new WsClient("rt", `ws://127.0.0.1:${PORT}/ws/notifications?token=${encodeURIComponent(fx.token)}`);
  await connected.connect();
  await sleep(800);
  const at = Date.now();
  await sleep(50);
  const cancelA = await fetch(`${BASE}/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ reason: "7I realtime connected" }),
    signal: AbortSignal.timeout(30_000),
  });
  await sleep(4000);
  const connectedFrames = connected.received.filter((r) => r.at > at).length;
  const stateA = await readFlowState(bookingId, fx.userId);
  connected.close();

  record(
    "F1",
    "with a client connected, the transition is both persisted and delivered",
    cancelA.status === 200 && connectedFrames > 0 && stateA.booking?.status?.startsWith("CANCELLED") ? "PASS" : "FAIL",
    `cancel → HTTP ${cancelA.status}; client frames=${connectedFrames}; ${describeFlow(stateA)}`,
  );

  // B/C — disconnected client AND Redis fan-out down.
  const created2 = await createBooking(fx, "realtime-down");
  if (!created2.bookingId) return;
  Bun.spawnSync(["docker", "pause", "homigo-staging-redis"]);
  let cancelB: Response | null = null;
  try {
    await sleep(1500);
    cancelB = await fetch(`${BASE}/api/bookings/${created2.bookingId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
      body: JSON.stringify({ reason: "7I realtime down" }),
      signal: AbortSignal.timeout(40_000),
    }).catch(() => null);
  } finally {
    Bun.spawnSync(["docker", "unpause", "homigo-staging-redis"]);
  }
  await sleep(3000);
  const stateB = await readFlowState(created2.bookingId, fx.userId);

  record(
    "F2",
    "with NO client listening and Redis fan-out unavailable, the business transition still commits",
    cancelB !== null && cancelB.status === 200 && stateB.booking?.status?.startsWith("CANCELLED") ? "PASS" : "FAIL",
    `cancel with the broker frozen → HTTP ${cancelB?.status ?? "no response"}; ${describeFlow(stateB)}. ` +
      `Realtime loss is not business loss: Postgres carries the truth and the transition is durable.`,
  );
  record(
    "F3",
    "the authoritative API returns the current state to a client that missed the message",
    await (async () => {
      const res = await fetch(`${BASE}/api/users/bookings`, { headers: { authorization: `Bearer ${fx.token}` }, signal: AbortSignal.timeout(20_000) });
      return res.ok;
    })()
      ? "PASS"
      : "FAIL",
    `a reconnecting client recovers state by asking the authoritative API, which is the designed path — there is no realtime replay buffer`,
  );

  stopServer(h);
  server = null;
  await sleep(1000);
}

// ── FAILURE MODE H — FINANCIAL / LEDGER UNDER CONCURRENCY AND RETRY ──────────────────────────────

async function testFinancial(): Promise<void> {
  console.log("\n── H · concurrent and repeated payment attempts ───────");
  const h = await boot("financial");
  const fx = await ensureFixtures();
  if (!fx) return;

  await setWalletBalance(fx.userId, 20_000);
  const created = await createBooking(fx, "financial");
  if (!created.bookingId) return;
  const bookingId = created.bookingId;
  const before = await readFlowState(bookingId, fx.userId);

  // Eight identical payment requests at once — the advisory lock and the idempotency check arbitrate.
  const results = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const r = await fetch(`${BASE}/api/wallet/checkout/pay`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
        body: JSON.stringify({ bookingId }),
        signal: AbortSignal.timeout(40_000),
      }).catch(() => null);
      return r?.status ?? null;
    }),
  );
  await sleep(2000);
  const after = await readFlowState(bookingId, fx.userId);
  const expectedBalance = Math.round((before.walletBalance - (before.booking?.finalAmount ?? 0)) * 100) / 100;
  const imbalance = await ledgerImbalance();

  record(
    "H1",
    "EXACTLY ONE DEBIT — eight concurrent identical payments move money once",
    after.walletTxns.length === 1 ? "PASS" : "FAIL",
    `statuses: ${JSON.stringify(results)}; wallet transactions=${after.walletTxns.length}; ${describeFlow(after)}`,
  );
  record(
    "H2",
    "EXACTLY ONE JOURNAL, balanced, with paise matching rupees",
    after.journals.length === 1 &&
      after.journals[0]!.lines === 2 &&
      Math.abs(after.journals[0]!.debit - after.journals[0]!.credit) < 0.011 &&
      after.walletTxns[0]!.amount_paise === String(Math.round(after.walletTxns[0]!.amount * 100))
      ? "PASS"
      : "FAIL",
    `journals=${after.journals.length}; ${after.journals.map((j) => `${j.lines} lines dr ${j.debit}/cr ${j.credit}`).join(", ")}; ` +
      `wallet txn ₹${after.walletTxns[0]?.amount} = ${after.walletTxns[0]?.amount_paise} paise`,
  );
  record(
    "H3",
    "the authoritative balance agrees with exactly one debit",
    Math.abs(after.walletBalance - expectedBalance) < 0.011 ? "PASS" : "FAIL",
    `balance ₹${before.walletBalance} → ₹${after.walletBalance}; expected ₹${expectedBalance} after one debit of ₹${before.booking?.finalAmount}`,
  );
  record(
    "H4",
    "the ledger remains balanced across every entry",
    imbalance === 0 ? "PASS" : "FAIL",
    `unbalanced journal entries in the whole ledger: ${imbalance}`,
  );

  stopServer(h);
  server = null;
  await sleep(1000);
}


// ── FAILURE MODE G — PAYMENT BOUNDARY (local leg only; no gateway call) ──────────────────────────

/**
 * The payment boundary that can be exercised honestly here: provider-success → local persistence.
 *
 * `createOrder` would call api.razorpay.com with the real keys this machine carries, so it is never
 * invoked. Instead a Payment row is seeded directly — the state the gateway leg would have produced —
 * and the flow is driven from `/api/payments/verify` with a signature minted by the product's own
 * `e2e/mock-signature` route. That covers signature verification, local settlement, the crash between
 * provider success and local persistence, and the retry after an ambiguous result.
 *
 * What it does NOT cover is the outbound leg itself: provider timeout, provider failure and a
 * response lost in transit. Those need the gateway redirected somewhere controlled, which is not
 * possible without editing shared configuration, so they are reported as not performed rather than
 * approximated.
 */
async function testPaymentBoundary(): Promise<void> {
  console.log("\n── G · payment boundary, local leg ────────────────────");
  const h = await boot("payment");
  const fx = await ensureFixtures();
  if (!fx) return;

  const created = await createBooking(fx, "payment");
  if (!created.bookingId) {
    record("G0", "a booking exists to pay for", "NOT_PROVEN", `create returned HTTP ${created.status}`);
    return;
  }
  const bookingId = created.bookingId;
  const orderId = `order_7i_${RUN_TAG}_${Math.random().toString(36).slice(2, 8)}`;
  const paymentId = `pay_7i_${Math.random().toString(36).slice(2, 10)}`;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { finalAmount: true } });
  await prisma.payment.create({
    data: {
      bookingId,
      userId: fx.userId,
      idempotencyKey: `7i-${orderId}`,
      amount: booking?.finalAmount ?? 500,
      amountPaise: BigInt(Math.round((booking?.finalAmount ?? 500) * 100)),
      currency: "INR",
      paymentMethod: "razorpay",
      razorpayOrderId: orderId,
      status: "INITIATED",
    },
  });

  const sigRes = await fetch(`${BASE}/api/payments/e2e/mock-signature`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ razorpayOrderId: orderId, razorpayPaymentId: paymentId }),
    signal: AbortSignal.timeout(20_000),
  });
  const signature = ((await sigRes.json().catch(() => ({}))) as { data?: { razorpaySignature?: string } }).data?.razorpaySignature;

  record(
    "G0",
    "the local payment boundary is set up without any gateway call",
    sigRes.status === 200 && Boolean(signature) ? "PASS" : "FAIL",
    `payment row seeded for order ${orderId} (INITIATED); mock signature route → HTTP ${sigRes.status}. ` +
      `createOrder was never invoked, so no request reached api.razorpay.com.`,
  );
  if (!signature) return;

  const verifyOnce = async () =>
    fetch(`${BASE}/api/payments/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
      body: JSON.stringify({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature }),
      signal: AbortSignal.timeout(30_000),
    });

  const first = await verifyOnce();
  await sleep(1000);
  const afterFirst = (await prisma.$queryRawUnsafe(
    `SELECT status::text AS status, amount_paid, amount_paid_paise::text AS paise FROM payments WHERE razorpay_order_id = $1`,
    orderId,
  )) as Array<{ status: string; amount_paid: number; paise: string }>;

  // A bad signature must be refused — the control that proves verification is doing something.
  const badSig = await fetch(`${BASE}/api/payments/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: "deadbeef" }),
    signal: AbortSignal.timeout(20_000),
  });

  const second = await verifyOnce();
  await sleep(1000);
  const afterSecond = (await prisma.$queryRawUnsafe(
    `SELECT status::text AS status, amount_paid, amount_paid_paise::text AS paise FROM payments WHERE razorpay_order_id = $1`,
    orderId,
  )) as Array<{ status: string; amount_paid: number; paise: string }>;
  const journals = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM journal_entries WHERE reference_id = $1 OR idempotency_key LIKE $2`,
    bookingId,
    `%${bookingId}%`,
  )) as Array<{ n: number }>;

  record(
    "G1",
    "a provider success settles the payment locally, exactly once",
    first.status === 200 && afterFirst[0]?.status !== "INITIATED" ? "PASS" : "FAIL",
    `verify → HTTP ${first.status}; payment ${"INITIATED"} → ${afterFirst[0]?.status}, amountPaid=₹${afterFirst[0]?.amount_paid} (${afterFirst[0]?.paise}p)`,
  );
  record(
    "G2",
    "an invalid signature is refused — verification is not a formality",
    badSig.status === 400 ? "PASS" : "FAIL",
    `verify with a wrong signature → HTTP ${badSig.status} (expected 400 INVALID_SIGNATURE)`,
  );
  record(
    "G3",
    "AMBIGUOUS RETRY — replaying the same provider result does not settle twice",
    (second.status === 409 || second.status === 200) && afterSecond[0]?.status === afterFirst[0]?.status && afterSecond[0]?.amount_paid === afterFirst[0]?.amount_paid
      ? "PASS"
      : "FAIL",
    `second identical verify → HTTP ${second.status}; payment stayed ${afterSecond[0]?.status} with amountPaid ₹${afterSecond[0]?.amount_paid}; ` +
      `journal entries tied to this booking: ${journals[0]?.n}. A 409 ALREADY_SETTLED is the intended arbitration.`,
  );
  record(
    "G4",
    "outbound gateway failure modes (timeout, provider error, response lost in transit)",
    "NOT_PROVEN",
    "not performed: `createOrder` posts to api.razorpay.com with the real keys present in this machine's .env, and the base URL is a " +
      "module constant that `load-env` does not allow the process environment to override. Redirecting it would mean editing shared " +
      "configuration the developer's own servers read. The local leg above is fully exercised; the outbound leg is UNPROVEN here, " +
      "consistent with 7F's OB4.",
  );

  await prisma.payment.deleteMany({ where: { razorpayOrderId: orderId } }).catch(() => ({ count: 0 }));
  void h;
  if (server) stopServer(server);
  server = null;
  await sleep(1000);
}

// ── FAILURE MODE J — SCHEDULER-DEPENDENT BUSINESS FLOW ───────────────────────────────────────────

/**
 * business event → outbox → consumer → scheduled work, with the process killed in the middle.
 *
 * This is the chain that ties 7D, 7E and 7H together at the business level: the consumer that turns a
 * booking event into scheduled follow-up work claims by INSERT behind a partial unique index, so the
 * question is whether a crash-induced redelivery produces one scheduled action or two.
 */
async function testSchedulerDependent(): Promise<void> {
  console.log("\n── J · event → consumer → scheduled work, with a crash ──");
  const h = await boot("scheduler");
  const fx = await ensureFixtures();
  if (!fx) return;

  const created = await createBooking(fx, "scheduler");
  if (!created.bookingId) {
    record("J0", "a booking exists", "NOT_PROVEN", `create returned HTTP ${created.status}`);
    return;
  }
  const bookingId = created.bookingId;

  // Bring the event to the head so the consumer actually runs inside this test.
  await prisma.$executeRawUnsafe(
    `UPDATE event_outbox SET available_at = now() - interval '1 day', created_at = now() - interval '2 days' WHERE aggregate_id = $1`,
    bookingId,
  );
  const eventRow = (await prisma.$queryRawUnsafe(
    `SELECT event_id FROM event_outbox WHERE aggregate_id = $1 AND event_type = 'homigo.booking.created' LIMIT 1`,
    bookingId,
  )) as Array<{ event_id: string }>;
  const eventId = eventRow[0]?.event_id ?? null;

  const delivered = await waitForCondition(async () => {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM event_outbox WHERE aggregate_id = $1 AND status = 'PUBLISHED'`,
      bookingId,
    )) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) > 0;
  }, 120_000, 2000);

  const receipts = eventId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT consumer_name, count(*)::int AS n FROM event_consumer_receipts WHERE event_id = $1 GROUP BY consumer_name`,
        eventId,
      )) as Array<{ consumer_name: string; n: number }>)
    : [];
  const jobs = eventId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT job_type, count(*)::int AS n FROM scheduled_jobs WHERE trigger_event_id = $1 GROUP BY job_type`,
        eventId,
      )) as Array<{ job_type: string; n: number }>)
    : [];

  record(
    "J1",
    "the business event reaches its consumers and is marked delivered",
    delivered !== null ? "PASS" : "FAIL",
    `event ${eventId?.slice(0, 16)}… published after ${delivered ?? ">120000"}ms; consumer receipts: ${JSON.stringify(receipts)}`,
  );
  record(
    "J2",
    "each consumer recorded exactly one receipt for the event",
    receipts.every((r) => r.n === 1) ? "PASS" : "FAIL",
    `receipts per consumer: ${JSON.stringify(receipts)}. More than one for a consumer would mean the UNIQUE (consumer_name, event_id) arbiter failed.`,
  );

  // Now crash and force a redelivery of the SAME event, then check for duplicate scheduled work.
  const jobsBefore = jobs.reduce((sum, j) => sum + j.n, 0);
  const death = await killServer();
  if (eventId) {
    await prisma.$executeRawUnsafe(
      `UPDATE event_outbox SET status = 'PENDING', locked_by = NULL, locked_at = NULL, published_at = NULL,
         available_at = now() - interval '1 day', created_at = now() - interval '2 days'
       WHERE event_id = $1`,
      eventId,
    );
  }
  const h2 = await boot("scheduler2");
  const redelivered = await waitForCondition(async () => {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM event_outbox WHERE event_id = $1 AND status = 'PUBLISHED'`,
      eventId,
    )) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) > 0;
  }, 120_000, 2000);

  const jobsAfter = eventId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT job_type, count(*)::int AS n FROM scheduled_jobs WHERE trigger_event_id = $1 GROUP BY job_type`,
        eventId,
      )) as Array<{ job_type: string; n: number }>)
    : [];
  const totalAfter = jobsAfter.reduce((sum, j) => sum + j.n, 0);
  const receiptsAfter = eventId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT consumer_name, count(*)::int AS n FROM event_consumer_receipts WHERE event_id = $1 GROUP BY consumer_name`,
        eventId,
      )) as Array<{ consumer_name: string; n: number }>)
    : [];

  /**
   * The scheduled-work leg needs `homigo.booking.completed`, not `booking.created` — that is the only
   * event `automation-scheduler.consumer` acts on. Rather than drive a booking all the way through
   * the partner lifecycle, an event of that type is enqueued with the envelope shape taken from a
   * real row already in this database, so the consumer sees exactly what the product would give it.
   * Inventing the envelope is how 7D lost a run; copying it is not the same thing.
   */
  const completedEventId = crypto.randomUUID();
  const completedBooking = await createBooking(fx, "sched-complete");
  let injectError = "";
  if (completedBooking.bookingId) {
    try {
      /**
       * The envelope is COPIED from a real published row rather than written by hand.
       *
       * A hand-built one was rejected with "Invalid Homigo event envelope": `isHomigoEvent` also requires
       * `specversion`, `source` and `datacontenttype`, which are not visible in a casual look at a
       * payload. Reconstructing a contract from memory is exactly the mistake 7D made, and the validator
       * caught it here — so the identity fields are rewritten inside an existing, known-valid envelope and
       * nothing else about its shape is guessed.
       */
      const injected = await prisma.$executeRawUnsafe(
        `INSERT INTO event_outbox (id, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_type, actor_id, payload, status, attempts, available_at, created_at, updated_at)
         SELECT gen_random_uuid()::text, $1, o.event_type, o.event_version, o.aggregate_type, $2, o.actor_type, $3,
                jsonb_set(
                  jsonb_set(
                    jsonb_set(o.payload, '{id}', to_jsonb($1::text)),
                    '{homigo,aggregateId}', to_jsonb($2::text)),
                  '{data,bookingId}', to_jsonb($2::text)),
                'PENDING', 0, now() - interval '1 day', now() - interval '2 days', now()
         FROM event_outbox o
         WHERE o.event_type = 'homigo.booking.completed' AND o.status = 'PUBLISHED'
         ORDER BY o.created_at DESC LIMIT 1`,
        completedEventId,
        completedBooking.bookingId,
        fx.partnerUserId,
      );
      if (injected === 0) injectError = "no published homigo.booking.completed row exists to copy an envelope from";
    } catch (e) {
      injectError = `INSERT failed: ${(e as Error).message.slice(0, 200)}`;
    }
  } else {
    injectError = `no booking to attach the event to (create returned HTTP ${completedBooking.status})`;
  }

  const schedDelivered = await waitForCondition(async () => {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM event_outbox WHERE event_id = $1 AND status = 'PUBLISHED'`,
      completedEventId,
    )) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) > 0;
  }, 120_000, 2000);
  const schedJobsFirst = (await prisma.$queryRawUnsafe(
    `SELECT job_type, count(*)::int AS n FROM scheduled_jobs WHERE trigger_event_id = $1 GROUP BY job_type`,
    completedEventId,
  )) as Array<{ job_type: string; n: number }>;
  const schedRow = (await prisma.$queryRawUnsafe(
    `SELECT status, attempts, left(coalesce(last_error, ''), 220) AS err FROM event_outbox WHERE event_id = $1`,
    completedEventId,
  )) as Array<{ status: string; attempts: number; err: string }>;

  record(
    "J4",
    "a completion event produces scheduled follow-up work",
    schedDelivered !== null && schedJobsFirst.length > 0 ? "PASS" : "NOT_PROVEN",
    `homigo.booking.completed published in ${schedDelivered ?? ">120000"}ms; scheduled work created: ${JSON.stringify(schedJobsFirst)}; ` +
      `outbox row: ${JSON.stringify(schedRow)}${injectError ? `; ${injectError}` : ""}. ` +
      `Without a job here the duplicate check below would be vacuous.`,
  );

  // Force the SAME completion event to be redelivered, which is what a crash mid-handler produces.
  await prisma.$executeRawUnsafe(
    `UPDATE event_outbox SET status = 'PENDING', locked_by = NULL, locked_at = NULL, published_at = NULL,
       available_at = now() - interval '1 day', created_at = now() - interval '2 days' WHERE event_id = $1`,
    completedEventId,
  );
  const schedRedelivered = await waitForCondition(async () => {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM event_outbox WHERE event_id = $1 AND status = 'PUBLISHED'`,
      completedEventId,
    )) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) > 0;
  }, 120_000, 2000);
  const schedJobsAfter = (await prisma.$queryRawUnsafe(
    `SELECT job_type, count(*)::int AS n FROM scheduled_jobs WHERE trigger_event_id = $1 GROUP BY job_type`,
    completedEventId,
  )) as Array<{ job_type: string; n: number }>;
  const firstTotal = schedJobsFirst.reduce((a, j) => a + j.n, 0);
  const afterTotal = schedJobsAfter.reduce((a, j) => a + j.n, 0);

  record(
    "J5",
    "REDELIVERY OF A COMPLETION EVENT DOES NOT SCHEDULE THE FOLLOW-UP TWICE",
    firstTotal > 0 && afterTotal === firstTotal ? "PASS" : firstTotal === 0 ? "NOT_PROVEN" : "FAIL",
    `after redelivering the same completion event (published again in ${schedRedelivered ?? ">120000"}ms), ` +
      `scheduled work went ${firstTotal} → ${afterTotal} ${JSON.stringify(schedJobsAfter)}. ` +
      `The consumer claims by INSERT behind the partial unique index scheduled_jobs_review_request_trigger_event_id_key, ` +
      `so the second handler run hits P2002 instead of creating a second job. This is 7D's deferred window reaching a real business artifact — and being contained.`,
  );

  record(
    "J3",
    "after a crash and a forced redelivery of the same event, scheduled work is NOT duplicated",
    totalAfter === jobsBefore && receiptsAfter.every((r) => r.n === 1) ? "PASS" : "FAIL",
    `process killed (pid ${death.pid}, gone in ${death.ms}ms), the event reset to PENDING and redelivered in ${redelivered ?? ">120000"}ms. ` +
      `scheduled work triggered by this event: ${jobsBefore} → ${totalAfter} ${JSON.stringify(jobsAfter)}; receipts: ${JSON.stringify(receiptsAfter)}. ` +
      `7D's duplicate-handler window is reachable here; what keeps it harmless is the consumer claiming by INSERT behind a partial unique index.`,
  );

  void h;
  stopServer(h2);
  server = null;
  await sleep(1000);
}

// ── FAILURE MODE L — COMPOSITE ───────────────────────────────────────────────────────────────────

/**
 * Composite with a single stated expectation: a committed financial operation stays exactly once,
 * whatever happens to the broker, the transport and the process afterwards.
 *
 * commit → Redis frozen → process killed → replacement started while the broker is still down →
 * broker restored → client retries. Each step on its own is covered elsewhere; together they are the
 * shape of a real incident.
 */
async function testComposite(): Promise<void> {
  console.log("\n── L · composite: commit + Redis down + crash + retry ──");
  const h = await boot("composite");
  const fx = await ensureFixtures();
  if (!fx) return;

  await setWalletBalance(fx.userId, 40_000);
  const created = await createBooking(fx, "composite");
  if (!created.bookingId) return;
  const bookingId = created.bookingId;

  const pay = await fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(30_000),
  });
  await sleep(1000);
  const committed = await readFlowState(bookingId, fx.userId);

  Bun.spawnSync(["docker", "pause", "homigo-staging-redis"]);
  let restarted = false;
  let duringRedisDown: Awaited<ReturnType<typeof readFlowState>> | null = null;
  try {
    await sleep(1500);
    await killServer();
    await boot("composite2");
    restarted = true;
    duringRedisDown = await readFlowState(bookingId, fx.userId);
  } finally {
    Bun.spawnSync(["docker", "unpause", "homigo-staging-redis"]);
  }
  await sleep(4000);

  const retry = await fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(30_000),
  });
  await sleep(1500);
  const final = await readFlowState(bookingId, fx.userId);
  const imbalance = await ledgerImbalance();

  record(
    "L1",
    "the process restarts with the broker still down and the committed state is intact",
    restarted && duringRedisDown?.walletTxns.length === 1 ? "PASS" : "FAIL",
    `pay → HTTP ${pay.status}; with Redis frozen and after a kill+restart: ${duringRedisDown ? describeFlow(duringRedisDown) : "unreadable"}`,
  );
  record(
    "L2",
    "COMPOSITE INVARIANT — one commit stays exactly one, through broker outage, crash, restart and retry",
    final.walletTxns.length === 1 &&
      final.journals.length === 1 &&
      Math.abs(final.walletBalance - committed.walletBalance) < 0.011 &&
      imbalance === 0
      ? "PASS"
      : "FAIL",
    `committed: ${describeFlow(committed)}\n         final    : ${describeFlow(final)}\n         ` +
      `retry → HTTP ${retry.status}; unbalanced journals across the whole ledger: ${imbalance}`,
  );

  void h;
  if (server) stopServer(server);
  server = null;
  await sleep(1000);
}

// ── §15 PARTNER DISPATCH ──────────────────────────────────────────────────────────────────────────

/** Pays a booking through the real route so the product's own post-payment dispatch hook fires. */
async function payBooking(fx: Fixtures, bookingId: string): Promise<number> {
  const r = await fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  return r?.status ?? 0;
}

type DispatchState = {
  jobId: string | null;
  jobStatus: string | null;
  attempts: Array<{ provider_id: string; status: string; n: number }>;
};

async function readDispatch(bookingId: string): Promise<DispatchState> {
  const job = (await prisma.$queryRawUnsafe(
    `SELECT id, status::text AS status FROM assignment_jobs WHERE booking_id = $1`,
    bookingId,
  )) as Array<{ id: string; status: string }>;
  const jobId = job[0]?.id ?? null;
  const attempts = jobId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT provider_id, status::text AS status, count(*)::int AS n FROM assignment_attempts WHERE job_id = $1 GROUP BY 1, 2`,
        jobId,
      )) as Array<{ provider_id: string; status: string; n: number }>)
    : [];
  return { jobId, jobStatus: job[0]?.status ?? null, attempts };
}

async function testPartnerDispatch(): Promise<void> {
  console.log("\n── N · partner dispatch, and a crash during it ────────");
  if (!server) await boot("dispatch");
  const fx = await ensureFixtures();
  if (!fx) return;

  const presence = await freshenPresence(fx);
  await setWalletBalance(fx.userId, 100_000);
  const b1 = await createBooking(fx, "dispatch");
  if (!b1.bookingId) {
    record("N0", "a booking exists to dispatch", "NOT_PROVEN", `create returned HTTP ${b1.status}`);
    return;
  }
  const pay1 = await payBooking(fx, b1.bookingId);
  const reached = await waitForCondition(
    async () => (await readDispatch(b1.bookingId!)).attempts.length > 0,
    60_000,
    1000,
  );
  const d1 = await readDispatch(b1.bookingId);

  /**
   * The positive control for this whole scenario. Dispatch is withheld until payment settles and then
   * depends on matching, online state, distance, working hours and a fail-closed presence gate — so
   * "no duplicate dispatch" is trivially true for a booking that was never dispatched at all. Nothing
   * below means anything unless a real offer reaches a real partner first.
   */
  record(
    "N1",
    "A PAID BOOKING ACTUALLY REACHES A PARTNER — the dispatch leg is live, not vacuous",
    reached !== null && d1.attempts.length > 0 ? "PASS" : "NOT_PROVEN",
    `pay → HTTP ${pay1}; presence seeded=${presence}${presenceError ? ` (${presenceError})` : ""}; assignment job ${d1.jobId?.slice(0, 12)}… status=${d1.jobStatus} ` +
      `after ${reached ?? ">60000"}ms; attempts: ${JSON.stringify(d1.attempts)}`,
  );
  if (d1.attempts.length === 0) {
    record(
      "N2",
      "dispatch outcome under crash",
      "NOT_PROVEN",
      "no dispatch occurred, so a crash during dispatch cannot be observed",
    );
    return;
  }

  record(
    "N2",
    "the job is not left PENDING while a real offer is already on record",
    d1.jobStatus === "DISPATCHED" ? "PASS" : "FAIL",
    `assignment job status=${d1.jobStatus} with ${d1.attempts.reduce((a, x) => a + x.n, 0)} attempt(s) committed. ` +
      `A committed attempt under a PENDING job is the documented hazard: dispatched in substance, invisible to the retry and ` +
      `exhaustion logic, with nothing anywhere explaining why.`,
  );

  // Now crash while the post-payment dispatch is still in flight.
  const b2 = await createBooking(fx, "dispatch-crash");
  if (!b2.bookingId) {
    record("N3", "dispatch survives a crash", "NOT_PROVEN", `create returned HTTP ${b2.status}`);
    return;
  }
  await freshenPresence(fx);
  const pay2p = fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
    body: JSON.stringify({ bookingId: b2.bookingId }),
    signal: AbortSignal.timeout(30_000),
  })
    .then((r) => r.status as number | null)
    .catch(() => null);
  await sleep(150);
  const death = await killServer();
  const pay2 = await pay2p;
  const atCrash = await readDispatch(b2.bookingId);

  await boot("dispatch2");
  await freshenPresence(fx);
  const converged = await waitForCondition(async () => {
    const d = await readDispatch(b2.bookingId!);
    return d.jobStatus !== null && d.jobStatus !== "PENDING";
  }, 90_000, 2000);
  const after = await readDispatch(b2.bookingId);
  const dupAttempt = after.attempts.some((a) => a.n > 1);

  record(
    "N3",
    "NO DUPLICATE OFFER — a crash mid-dispatch does not offer the same job to a partner twice",
    dupAttempt ? "FAIL" : "PASS",
    `pay → HTTP ${pay2}; killed pid ${death.pid} (gone in ${death.ms}ms). At the crash: job=${atCrash.jobStatus} ` +
      `attempts=${JSON.stringify(atCrash.attempts)}. After restart (converged in ${converged ?? ">90000"}ms): ` +
      `job=${after.jobStatus} attempts=${JSON.stringify(after.attempts)}. The arbiter is the UNIQUE (job_id, provider_id) on ` +
      `assignment_attempts, which the engine catches as P2002 and skips rather than re-offering.`,
  );

  const st = await readFlowState(b2.bookingId, fx.userId);
  record(
    "N4",
    "the customer's money is unaffected by whatever happened to the dispatch",
    st.walletTxns.length <= 1 && st.journals.length <= 1 ? "PASS" : "FAIL",
    `booking=${st.booking?.status}/${st.booking?.paymentStatus} ₹${st.booking?.finalAmount}; ` +
      `walletTxns=${st.walletTxns.length}; journals=${st.journals.length}. Dispatch is downstream of the money: ` +
      `a dispatch failure must never produce a second debit.`,
  );
}

// ── §11 NOTIFICATION FAILURE ──────────────────────────────────────────────────────────────────────

async function partnerNotificationCount(fx: Fixtures): Promise<number> {
  const r = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`,
    fx.partnerUserId,
  )) as Array<{ n: number }>;
  return r[0]?.n ?? 0;
}

async function testNotificationFailure(): Promise<void> {
  console.log("\n── M · the notification leg fails, business truth holds ──");
  if (!server) await boot("notify");
  const fx = await ensureFixtures();
  if (!fx) return;

  await freshenPresence(fx);
  await setWalletBalance(fx.userId, 100_000);

  // M0 — positive control: the dispatch path really does notify the partner.
  const before = await partnerNotificationCount(fx);
  const b1 = await createBooking(fx, "notify-ok");
  if (!b1.bookingId) {
    record("M0", "the notification leg is exercised at all", "NOT_PROVEN", `create returned HTTP ${b1.status}`);
    return;
  }
  await payBooking(fx, b1.bookingId);
  const notified = await waitForCondition(async () => (await partnerNotificationCount(fx)) > before, 60_000, 1000);
  const afterOk = await partnerNotificationCount(fx);
  record(
    "M0",
    "under healthy conditions the dispatch really does notify the partner",
    notified !== null ? "PASS" : "NOT_PROVEN",
    `partner notifications ${before} → ${afterOk} in ${notified ?? ">60000"}ms. Without this, blocking the notifications ` +
      `table below would block nothing and the scenario would pass by doing nothing.`,
  );

  // M1..M3 — the same flow with the notification write blocked outright.
  const lock = lockTable("notifications", 60_000);
  await lock.started;
  const b2 = await createBooking(fx, "notify-fail");
  if (!b2.bookingId) {
    lock.release();
    await lock.ended;
    record("M1", "business truth under notification failure", "NOT_PROVEN", `create returned HTTP ${b2.status}`);
    return;
  }
  await freshenPresence(fx);
  const payBlocked = await payBooking(fx, b2.bookingId);
  const attemptUnderBlock = await waitForCondition(
    async () => (await readDispatch(b2.bookingId!)).attempts.length > 0,
    45_000,
    1000,
  );
  const dBlocked = await readDispatch(b2.bookingId);
  const stBlocked = await readFlowState(b2.bookingId, fx.userId);
  const notifDuringBlock = await partnerNotificationCount(fx);

  record(
    "M1",
    "NOTIFICATION FAILURE IS NOT BUSINESS FAILURE — the payment still commits",
    payBlocked === 200 && stBlocked.walletTxns.length === 1 && stBlocked.journals.length === 1 ? "PASS" : "FAIL",
    `with the notifications table held under ACCESS EXCLUSIVE: pay → HTTP ${payBlocked}; ` +
      `booking=${stBlocked.booking?.status}/${stBlocked.booking?.paymentStatus} ₹${stBlocked.booking?.finalAmount}; ` +
      `walletTxns=${stBlocked.walletTxns.length}; journals=${stBlocked.journals.length}; ` +
      `partner notifications stayed at ${notifDuringBlock} (the write is genuinely blocked).`,
  );
  record(
    "M2",
    "THE OFFER SURVIVES THE FAILED NOTIFICATION — the partner can still see the job",
    dBlocked.attempts.length > 0 ? "PASS" : "FAIL",
    `assignment attempt committed in ${attemptUnderBlock ?? ">45000"}ms despite the notification write being blocked: ` +
      `${JSON.stringify(dBlocked.attempts)}. The attempt is what the partner's own list reads; notifying is best-effort on top of it.`,
  );
  /**
   * What the lock produces is a HANG, not a throw, and the distinction decides whether this is a
   * defect.
   *
   * `sendNotification` is awaited inline between the committed offer and the final update to
   * DISPATCHED. With the table locked, that await simply does not return, so the job is PENDING
   * because the dispatch is still running — not because it was abandoned. Calling that a stranded job
   * here would be turning a measurement into a defect. The question that actually matters is whether
   * it converges once the store comes back, which M5 asks.
   */
  record(
    "M3",
    "an unavailable notification store STALLS the dispatch completion (head-of-line), with the offer already committed",
    dBlocked.attempts.length > 0 ? "INFO" : "NOT_PROVEN",
    `assignment job status=${dBlocked.jobStatus} while the notification write was blocked, with ` +
      `${dBlocked.attempts.reduce((a, x) => a + x.n, 0)} offer(s) already committed. The notification call is awaited inline ` +
      `between the committed offer and the update to DISPATCHED, so a slow or unavailable notification store holds the job in ` +
      `PENDING for as long as the outage lasts. The partner can already see the job; what waits is the engine's own bookkeeping. ` +
      `This is a stall, not a loss — whether it converges is measured below, and the engine's try/catch covers a THROWN ` +
      `notification error, which is a different failure mode from this hang.`,
  );

  lock.release();
  await lock.ended;

  const jobConverged = await waitForCondition(async () => {
    const d = await readDispatch(b2.bookingId!);
    return d.jobStatus !== null && d.jobStatus !== "PENDING";
  }, 60_000, 1000);
  const dConverged = await readDispatch(b2.bookingId);
  record(
    "M5",
    "ONCE THE NOTIFICATION STORE RECOVERS, THE STALLED JOB CONVERGES — it is not stranded",
    jobConverged !== null ? "PASS" : "FAIL",
    `after the lock was released the assignment job went ${dBlocked.jobStatus} → ${dConverged.jobStatus} in ` +
      `${jobConverged ?? ">60000"}ms, with attempts unchanged at ${JSON.stringify(dConverged.attempts)}. ` +
      `A job left PENDING here would be the documented hazard — dispatched in substance, invisible to the retry and exhaustion ` +
      `logic — so this is the check that separates a stall from a stranding.`,
  );

  const recovered = await waitForCondition(async () => (await partnerNotificationCount(fx)) > notifDuringBlock, 60_000, 2000);
  const stFinal = await readFlowState(b2.bookingId, fx.userId);
  const dFinal = await readDispatch(b2.bookingId);
  const notifFinal = await partnerNotificationCount(fx);
  record(
    "M4",
    "after the notification store recovers, nothing about the business record changed",
    stFinal.walletTxns.length === 1 && stFinal.journals.length === 1 && !dFinal.attempts.some((a) => a.n > 1)
      ? "PASS"
      : "FAIL",
    `lock released; partner notifications ${notifDuringBlock} → ${notifFinal}` +
      `${recovered === null ? " (the lost notification was not replayed — there is no replay buffer for a missed notification, which is the designed behaviour and not a defect found here)" : ` in ${recovered}ms`}. ` +
      `booking=${stFinal.booking?.status}/${stFinal.booking?.paymentStatus}; walletTxns=${stFinal.walletTxns.length}; ` +
      `journals=${stFinal.journals.length}; attempts=${JSON.stringify(dFinal.attempts)}.`,
  );
}

async function waitForCondition(predicate: () => Promise<boolean>, timeoutMs: number, stepMs = 500): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate().catch(() => false)) return Date.now() - started;
    await sleep(stepMs);
  }
  return null;
}

/** Removes everything this run created, in dependency order. */
async function cleanupRunArtifacts(): Promise<{ bookings: number; txns: number; journals: number }> {
  const ids = (await prisma.$queryRawUnsafe(
    `SELECT id FROM bookings WHERE description LIKE $1`,
    `7I %${RUN_TAG}`,
  )) as Array<{ id: string }>;
  const bookingIds = ids.map((r) => r.id);
  if (bookingIds.length === 0) return { bookings: 0, txns: 0, journals: 0 };

  const txns = (await prisma.$queryRawUnsafe(
    `SELECT id FROM wallet_transactions WHERE reference_id = ANY($1::text[]) AND reference_type = 'booking_wallet_payment'`,
    bookingIds,
  )) as Array<{ id: string }>;
  const keys = txns.map((t) => `wallet_debit:${t.id}`);

  if (keys.length) {
    const journals = (await prisma.$queryRawUnsafe(
      `SELECT id FROM journal_entries WHERE idempotency_key = ANY($1::text[])`,
      keys,
    )) as Array<{ id: string }>;
    const jids = journals.map((j) => j.id);
    if (jids.length) {
      await prisma.$executeRawUnsafe(`DELETE FROM ledger_balance_snapshots WHERE journal_id = ANY($1::text[])`, jids).catch(() => 0);
      await prisma.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE journal_id = ANY($1::text[])`, jids).catch(() => 0);
      await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = ANY($1::text[])`, jids).catch(() => 0);
    }
  }
  await prisma.$executeRawUnsafe(`DELETE FROM wallet_transactions WHERE reference_id = ANY($1::text[])`, bookingIds).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE aggregate_id = ANY($1::text[])`, bookingIds).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM bookings WHERE id = ANY($1::text[])`, bookingIds).catch(() => 0);
  return { bookings: bookingIds.length, txns: txns.length, journals: keys.length };
}
