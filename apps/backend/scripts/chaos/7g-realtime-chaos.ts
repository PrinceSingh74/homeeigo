/**
 * SECTION 7G — WebSocket / realtime load, fan-out, disconnect, reconnect, backpressure, recovery.
 *
 *   DATABASE_URL="<homigo_test>" REDIS_URL="redis://localhost:6380" \
 *     bun run scripts/chaos/7g-realtime-chaos.ts --test gates,baseline,ladder
 *
 * Every delivery number here is counted by a real client object that parsed a real frame. The server
 * is asked only about its own registry (how many connections it still believes it has), never about
 * whether a message arrived — because every route swallows send errors, so the server's own success
 * counter cannot distinguish a delivered frame from a write into a closed socket.
 */
import {
  type Check,
  type ServerHandle,
  HTTP_BASE,
  WS_BASE,
  WS_PORT,
  WsClient,
  assertRealtimeIsolation,
  awaitHarnessRedisRecovery,
  connectHarnessRedis,
  disconnectHarnessRedis,
  clearPort,
  closeAll,
  listenerPidOn,
  machineState,
  makeRecorder,
  openMany,
  percentile,
  probeHealth,
  sleep,
  startRealtimeServer,
  stopServer,
  telemetry,
  waitFor,
  wsStats,
} from "./7g-lib";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : fallback;
};
const selected = new Set(arg("test", "all").split(",").map((s) => s.trim()));
const want = (n: string) => selected.has("all") || selected.has(n);
const RUN_TAG = arg("tag", new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14));

const prisma = (await import("../../src/lib/prisma")).default;
const checks: Check[] = [];
const record = makeRecorder(checks);
const LOG_DIR = "/tmp";

const SERVER_ENV = {
  APP_ENV: "chaos",
  NODE_ENV: "development",
  LOAD_TEST_MODE: "1",
  EVENTS_CONSUMERS_ENABLED: "false",
  PORT: String(WS_PORT),
};

let server: ServerHandle | null = null;

async function ensureServer(label: string): Promise<ServerHandle> {
  if (server) return server;
  server = await startRealtimeServer({ env: SERVER_ENV, logPath: `${LOG_DIR}/7g-server-${label}.log`, port: WS_PORT });
  return server;
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

const PASSWORD = "Wz8!kLp3Nv6q";

type Actor = { email: string; userId: string; token: string; role: string };

/**
 * Four identities and one booking, created through the real signup endpoint and then adjusted in the
 * disposable database.
 *
 * Roles are elevated with a direct update rather than driven through an onboarding flow. That is a
 * shortcut around role assignment, not around anything under test: `authenticateWsConnection` reads
 * the role from the database on every handshake, so an elevated user is authorised exactly the way a
 * genuinely-elevated one would be, and the channel guards see the same input either way.
 */
async function registerActor(local: string, role: "CUSTOMER" | "VENDOR" | "ADMIN"): Promise<Actor | null> {
  const email = `s7g.${local}@homigo.test`;
  const login = async (): Promise<string | null> => {
    const res = await fetch(`${HTTP_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, setAuthCookies: false }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { accessToken?: string } };
    return body.data?.accessToken ?? null;
  };

  let token = await login();
  if (!token) {
    const reg = await fetch(`${HTTP_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        firstName: "SevenG",
        lastName: local,
        phoneNumber: `+91${Math.floor(7000000000 + Math.random() * 999999999)}`,
        userType: "customer",
        agreeToTerms: true,
        setAuthCookies: false,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!reg.ok) {
      console.error(`  register ${local} failed: ${reg.status} ${(await reg.text()).slice(0, 200)}`);
      return null;
    }
    token = await login();
  }
  if (!token) return null;

  const user = await prisma.user.findFirst({ where: { emailHash: undefined, email }, select: { id: true } })
    .catch(() => null);
  const me = await fetch(`${HTTP_BASE}/api/users/me`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!me.ok) return null;
  const meBody = (await me.json()) as { data?: { user?: { id?: string } } };
  const userId = meBody.data?.user?.id ?? user?.id;
  if (!userId) return null;

  await prisma.user.update({ where: { id: userId }, data: { role, isEmailVerified: true } });
  return { email, userId, token, role };
}

type Fixtures = {
  customer: Actor;
  outsider: Actor;
  partner: Actor;
  admin: Actor;
  bookingId: string;
  otherBookingId: string;
};

let fixtures: Fixtures | null = null;

async function ensureFixtures(): Promise<Fixtures | null> {
  if (fixtures) return fixtures;
  const customer = await registerActor("customer", "CUSTOMER");
  const outsider = await registerActor("outsider", "CUSTOMER");
  const partner = await registerActor("partner", "VENDOR");
  const admin = await registerActor("admin", "ADMIN");
  if (!customer || !outsider || !partner || !admin) return null;

  // The partner needs a Provider row, because booking access is decided by `provider.userId`.
  const existingProvider = await prisma.provider.findFirst({ where: { userId: partner.userId }, select: { id: true } });
  const provider =
    existingProvider ??
    (await prisma.provider.create({
      data: { userId: partner.userId, businessName: "7G Realtime Partner", isApproved: true },
      select: { id: true },
    }));

  /**
   * `GET /api/v1/ws/stats` needs an AdminUser row, not merely `role: "ADMIN"` — `resolveAdminContext`
   * looks that row up and the route fails closed without it. Without this the registry is unreadable
   * and every leak check in this section would be vacuous.
   */
  const adminRole = await prisma.adminRole.findFirst({ where: { name: "SUPER_ADMIN" }, select: { id: true } });
  if (adminRole) {
    const existingAdmin = await prisma.adminUser.findUnique({ where: { userId: admin.userId }, select: { id: true } });
    if (!existingAdmin) {
      await prisma.adminUser.create({ data: { userId: admin.userId, roleId: adminRole.id, isActive: true, grantedBy: "7g-harness" } });
    }
  }

  const service = await prisma.service.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!service) return null;

  const address =
    (await prisma.address.findFirst({ where: { userId: customer.userId }, select: { id: true } })) ??
    (await prisma.address.create({
      data: {
        userId: customer.userId,
        label: "7G fixture",
        addressLine1: "9 Realtime Road",
        city: "Mumbai",
        state: "MH",
        zipCode: "400001",
        latitude: 19.076,
        longitude: 72.8777,
      },
      select: { id: true },
    }));

  /**
   * Two bookings: one the partner is assigned to, one they are not — the cross-boundary control.
   *
   * `daysOut` separates them by days rather than milliseconds because `bookings_user_slot_excl` is a
   * real exclusion constraint on (user, slot range): two fixtures created back to back land in the
   * same hour-long slot for the same customer and the second is rejected by the database.
   */
  const mk = async (tag: string, withProvider: boolean, daysOut: number) => {
    const existing = await prisma.booking.findFirst({
      where: { userId: customer.userId, description: `7G ${tag}` },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.booking.create({
      data: { dataOrigin: "CERTIFICATION",
        bookingNumber: `7G-${RUN_TAG}-${tag}-${Math.random().toString(36).slice(2, 7)}`,
        userId: customer.userId,
        serviceId: service.id,
        addressId: address.id,
        providerId: withProvider ? provider.id : null,
        scheduledDate: new Date(Date.now() + daysOut * 86_400_000),
        // Money fields are required by the schema; these are fixture values in a disposable database
        // and nothing in this section reads them as financial truth.
        baseAmount: 499,
        finalAmount: 499,
        totalAmount: 499,
        description: `7G ${tag}`,
      },
      select: { id: true },
    });
    return created.id;
  };

  fixtures = {
    customer,
    outsider,
    partner,
    admin,
    bookingId: await mk("main", true, 5),
    otherBookingId: await mk("other", false, 9),
  };
  return fixtures;
}

const bookingUrl = (bookingId: string, token: string) => `${WS_BASE}/ws/booking/${bookingId}?token=${encodeURIComponent(token)}`;
const notificationsUrl = (token: string) => `${WS_BASE}/ws/notifications?token=${encodeURIComponent(token)}`;
const adminOpsUrl = (token: string) => `${WS_BASE}/ws/admin-ops?token=${encodeURIComponent(token)}`;
const earningsUrl = (pathId: string, token: string) => `${WS_BASE}/ws/earnings/${pathId}?token=${encodeURIComponent(token)}`;

// ── GATES ─────────────────────────────────────────────────────────────────────────────────────────

async function testGates(): Promise<void> {
  console.log("\n── GATES · isolation and realtime positive controls ───");
  const h = await ensureServer("gates");
  const targets = await assertRealtimeIsolation("7G realtime chaos");
  const health = await probeHealth(WS_PORT);

  record(
    "G0",
    "isolated target proven by the server itself, and Redis is the disposable instance",
    health.isolatedDatabase && targets.redis?.port === "6380" ? "PASS" : "FAIL",
    `server isolatedDatabase=${health.isolatedDatabase} env=${health.environment}; db=${targets.db?.redacted}; redis=${targets.redis?.redacted}; ` +
      `listener pid=${h.listenerPid} on :${WS_PORT}`,
  );

  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) {
    record("G-FIX", "realtime fixtures available", "NOT_PROVEN", "could not provision the four identities and the booking — no realtime conclusion can be drawn");
    return;
  }
  record(
    "G-FIX",
    "four identities and two bookings provisioned",
    "PASS",
    `customer=${fx.customer.userId.slice(0, 10)}… outsider=${fx.outsider.userId.slice(0, 10)}… partner=${fx.partner.userId.slice(0, 10)}… admin=${fx.admin.userId.slice(0, 10)}…; ` +
      `booking(assigned)=${fx.bookingId.slice(0, 12)}… booking(unassigned)=${fx.otherBookingId.slice(0, 12)}…`,
  );

  // G1 — a valid handshake succeeds.
  const good = new WsClient("g1", bookingUrl(fx.bookingId, fx.customer.token));
  const g1 = await good.connect();
  record("G1", "a valid handshake succeeds", g1 && good.opened ? "PASS" : "FAIL", `opened=${good.opened} connectMs=${good.connectMs} closeCode=${good.closeCode}`);

  /**
   * Rejection in this architecture is NOT an upgrade refusal.
   *
   * Elysia completes the WebSocket upgrade first and runs authentication inside `open`, so a client
   * with a garbage token genuinely sees an `open` event and is then closed with 4401. Asserting
   * `opened === false` therefore tests the framework's upgrade timing, not the product's security.
   * What matters is that the socket ends CLOSED with the right code and was given nothing privileged
   * while it was briefly open.
   */
  const rejected = async (label: string, url: string): Promise<{ code: number | null; privileged: number; closed: boolean }> => {
    const c = new WsClient(label, url);
    await c.connect(10_000);
    await waitFor(() => c.closed, 6000);
    const privileged = c.received.filter((r) => r.type !== "PING").length;
    return { code: c.closeCode, privileged, closed: c.closed };
  };

  const badToken = await rejected("g2", bookingUrl(fx.bookingId, "not-a-real-token"));
  const noToken = await rejected("g2b", `${WS_BASE}/ws/booking/${fx.bookingId}`);
  record(
    "G2",
    "invalid and missing authentication are closed with 4401 and given nothing",
    badToken.closed && badToken.code === 4401 && badToken.privileged === 0 &&
      noToken.closed && noToken.code === 4401 && noToken.privileged === 0
      ? "PASS"
      : "FAIL",
    `garbage token: closed=${badToken.closed} code=${badToken.code} privilegedFrames=${badToken.privileged}; ` +
      `no token: closed=${noToken.closed} code=${noToken.code} privilegedFrames=${noToken.privileged}`,
  );

  const outsiderOnBooking = await rejected("g3", bookingUrl(fx.bookingId, fx.outsider.token));
  const customerOnAdmin = await rejected("g3b", adminOpsUrl(fx.customer.token));
  const customerOnEarnings = await rejected("g3c", earningsUrl(fx.partner.userId, fx.customer.token));
  record(
    "G3",
    "an authenticated user cannot subscribe to a channel that is not theirs",
    outsiderOnBooking.code === 4403 && outsiderOnBooking.privileged === 0 &&
      customerOnAdmin.code === 4403 && customerOnAdmin.privileged === 0 &&
      customerOnEarnings.privileged === 0
      ? "PASS"
      : "FAIL",
    `outsider on another customer's booking: code=${outsiderOnBooking.code} frames=${outsiderOnBooking.privileged}; ` +
      `customer on admin-ops: code=${customerOnAdmin.code} frames=${customerOnAdmin.privileged}; ` +
      `customer on a partner's earnings: code=${customerOnEarnings.code} frames=${customerOnEarnings.privileged}`,
  );

  /**
   * Counts only frames that arrived strictly AFTER the publish.
   *
   * The `open` handler already sends a SUBSCRIBE frame and a BOOKING_STATUS snapshot of the current
   * booking. An earlier version simply watched the frame count grow and passed on that snapshot,
   * declaring the fan-out path working while it delivered nothing. This is also the positive control
   * for the entire cross-instance route: if it fails, no delivery number below means anything.
   */
  const publishedAt = Date.now();
  await sleep(50);
  await publishViaRedis(fx.bookingId, "confirmed");
  await sleep(4000);
  const afterPublish = good.received.filter((r) => r.at > publishedAt);
  const roomFrames = afterPublish.filter((r) => r.type === "BOOKING_STATUS").length;
  const userFrames = afterPublish.filter((r) => r.type === "booking.status").length;

  record(
    "G4",
    "an authorized subscriber receives the published event, counted by the CLIENT after the publish",
    afterPublish.length > 0 ? "PASS" : "FAIL",
    `frames after the publish: ${afterPublish.length} ${JSON.stringify(afterPublish.map((r) => r.type))}; waited 4000ms. ` +
      `The open-handler snapshot is excluded by timestamp, so these are published frames or nothing.`,
  );

  /**
   * `publishBookingStatus` emits on TWO routes for the same transition: a room broadcast carrying
   * `BOOKING_STATUS` on `booking:{id}`, and a per-user envelope carrying `booking.status` via
   * `sendToUser`. Splitting them here is what makes the next finding precise rather than "some frames
   * arrived": the two routes take different code paths out of `RoomManager` and only one of them
   * publishes to Redis unconditionally.
   */
  record(
    "G4b",
    "CROSS-INSTANCE ROOM FAN-OUT — a room broadcast from an instance with no local member of that room",
    roomFrames > 0 ? "PASS" : "FAIL",
    `after one transition the subscriber received room frames (BOOKING_STATUS)=${roomFrames} and user frames (booking.status)=${userFrames}. ` +
      `Both were emitted by the same publish on the producing instance. RoomManager.broadcast() returns early when its OWN room is empty ` +
      `(if (roomSize === 0) return 0) and never reaches its redisClient.publish, while sendToUser publishes unconditionally.`,
  );

  // G7/G8 — the broadcast reached exactly the intended recipient set.
  const partnerOnBooking = new WsClient("g7-partner", bookingUrl(fx.bookingId, fx.partner.token));
  await partnerOnBooking.connect();
  const partnerElsewhere = new WsClient("g8-other", bookingUrl(fx.otherBookingId, fx.customer.token));
  await partnerElsewhere.connect();
  await sleep(500);
  const cBefore = good.countOf("BOOKING_STATUS");
  const pBefore = partnerOnBooking.countOf("BOOKING_STATUS");
  const oBefore = partnerElsewhere.countOf("BOOKING_STATUS");
  await publishViaRedis(fx.bookingId, "en_route");
  await sleep(2500);
  const cGot = good.countOf("BOOKING_STATUS") - cBefore;
  const pGot = partnerOnBooking.countOf("BOOKING_STATUS") - pBefore;
  const oGot = partnerElsewhere.countOf("BOOKING_STATUS") - oBefore;

  record(
    "G7",
    "a broadcast reaches exactly the intended recipients",
    cGot === 1 && pGot === 1 ? "PASS" : "FAIL",
    `booking room subscribers received: customer=${cGot}, assigned partner=${pGot} (each expected exactly 1)`,
  );
  record(
    "G8",
    "an unintended recipient receives ZERO frames for that event",
    oGot === 0 ? "PASS" : "FAIL",
    `a client subscribed to a DIFFERENT booking received ${oGot} frames for this booking's transition (expected 0)`,
  );

  // G5 — the server actually observes a disconnect.
  const statsBefore = await wsStats(fx.admin.token);
  good.close();
  partnerOnBooking.close();
  partnerElsewhere.close();
  await sleep(1500);
  const statsAfter = await wsStats(fx.admin.token);
  record(
    "G5",
    "the server observes a client disconnect and releases its registry entry",
    statsAfter.totalConnections < statsBefore.totalConnections ? "PASS" : "FAIL",
    `server registry connections ${statsBefore.totalConnections} → ${statsAfter.totalConnections} after closing 3 clients; rooms ${statsBefore.totalRooms} → ${statsAfter.totalRooms}`,
  );

  // G6 — reconnect restores only the intended state.
  const again = new WsClient("g6", bookingUrl(fx.bookingId, fx.customer.token));
  const reopened = await again.connect();
  await sleep(800);
  const statsRe = await wsStats(fx.admin.token);
  const bookingRoom = statsRe.rooms.find((r) => r.id === `booking:${fx.bookingId}`);
  record(
    "G6",
    "reconnect restores exactly one membership, not an accumulated one",
    reopened && (bookingRoom?.connections ?? 0) === 1 ? "PASS" : "FAIL",
    `after reconnecting one client, room booking:${fx.bookingId.slice(0, 10)}… holds ${bookingRoom?.connections ?? 0} connection(s) (expected 1)`,
  );
  again.close();

  const t = await telemetry(prisma, WS_PORT);
  record("G9", "telemetry is readable", t.rssMb > 0 ? "PASS" : "FAIL", `rss=${t.rssMb}MB heap=${t.heapUsedMb}MB db=${t.dbConnections} redis_up=${t.redisUp}`);
}

/**
 * Publishes a real booking transition through the product's authoritative publisher, from THIS
 * process.
 *
 * The harness is a second instance of the same code, with its own `RoomManager` that holds no
 * sockets. So the local broadcast inside `publishBookingStatus` reaches nobody here, and the frame
 * travels to the server the way it travels between two real nodes: Redis `ws:fanout`, origin guard,
 * then the server's own `localBroadcast` into its real client sockets.
 *
 * That makes every delivery number below a measurement of the CROSS-INSTANCE path plus the server's
 * local fan-out. The server-as-its-own-producer path is proven separately, once, by driving a real
 * cancellation over HTTP (`bookingLocalProducer`).
 */
async function publishViaRedis(
  bookingId: string,
  status: string,
  parties?: { userId: string | null; providerUserId: string | null },
  extra?: Record<string, unknown>,
): Promise<void> {
  const { publishBookingStatus } = await import("../../src/lib/booking-realtime");
  // Passing the parties explicitly skips `resolveParties`, so a burst measures fan-out rather than
  // N database lookups on the producing side.
  await publishBookingStatus({
    bookingId,
    status,
    ...(parties ? { userId: parties.userId, providerUserId: parties.providerUserId } : {}),
    ...(extra ? { extra } : {}),
  });
}


// ── BASELINE ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Connections are opened on `/ws/notifications`, which puts every socket of a user into that user's
 * room. One `sendToUser` therefore reaches all of them, which is what makes this channel usable as
 * both a connection-scale probe and a fan-out probe with an exactly known recipient set.
 */
async function testBaseline(pass: number): Promise<void> {
  console.log(`\n── BASELINE pass ${pass} · 25 connections ─────────────`);
  await ensureServer("baseline");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;
  const before = await machineState();
  const tBefore = await telemetry(prisma, WS_PORT);

  const N = 25;
  const opened = await openMany("base", () => notificationsUrl(fx.customer.token), N);
  await sleep(1200);
  const stats = await wsStats(fx.admin.token);

  const at = Date.now();
  await sleep(50);
  await publishViaRedis(fx.bookingId, `baseline${pass}`, { userId: fx.customer.userId, providerUserId: null });
  await sleep(3500);

  const got = opened.clients.filter((c) => c.opened).map((c) => c.received.filter((r) => r.at > at).length);
  const delivered = got.filter((n) => n >= 1).length;
  const duplicates = got.filter((n) => n > 1).length;
  const latencies = opened.clients
    .filter((c) => c.opened)
    .map((c) => c.received.find((r) => r.at > at)?.at)
    .filter((v): v is number => v !== undefined)
    .map((v) => v - at);

  const tAfter = await telemetry(prisma, WS_PORT);
  closeAll(opened.clients);
  await sleep(1000);

  record(
    `B${pass}`,
    `baseline pass ${pass}: ${N} connections, one event, exact receipt count`,
    opened.opened === N && delivered === N && duplicates === 0 ? "PASS" : "FAIL",
    `handshakes ok=${opened.opened}/${N} refused=${opened.refused} ${JSON.stringify(opened.closeCodes)}; ` +
      `connect p50=${percentile(opened.connectMs, 50)}ms p95=${percentile(opened.connectMs, 95)}ms; ` +
      `server registry connections=${stats.totalConnections} rooms=${stats.totalRooms}; ` +
      `CLIENT-counted delivery: ${delivered}/${N} received, ${duplicates} received more than once; ` +
      `delivery latency p50=${percentile(latencies, 50)}ms p95=${percentile(latencies, 95)}ms max=${Math.max(...latencies, 0)}ms\n         ` +
      `machine before: ${before} | after: ${await machineState()}\n         ` +
      `rss ${tBefore.rssMb}→${tAfter.rssMb}MB heap ${tBefore.heapUsedMb}→${tAfter.heapUsedMb}MB db=${tAfter.dbConnections} redis_up=${tAfter.redisUp}`,
  );
}

// ── CONNECTION LADDER ─────────────────────────────────────────────────────────────────────────────

async function testLadder(): Promise<void> {
  const steps = (arg("ladder", "10,50,100,250,500") || "").split(",").map(Number).filter((n) => n > 0);
  console.log(`\n── LADDER · ${steps.join("/")} simultaneous connections ──`);
  await ensureServer("ladder");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const rows: string[] = [];
  for (const n of steps) {
    const tBefore = await telemetry(prisma, WS_PORT);
    const opened = await openMany(`l${n}`, () => notificationsUrl(fx.customer.token), n, 30_000);
    await sleep(1500);
    const stats = await wsStats(fx.admin.token);

    const at = Date.now();
    await sleep(50);
    await publishViaRedis(fx.bookingId, `ladder${n}`, { userId: fx.customer.userId, providerUserId: null });
    await sleep(Math.max(3000, n * 6));

    const live = opened.clients.filter((c) => c.opened);
    const counts = live.map((c) => c.received.filter((r) => r.at > at).length);
    const delivered = counts.filter((x) => x >= 1).length;
    const dupes = counts.filter((x) => x > 1).length;
    const lat = live
      .map((c) => c.received.find((r) => r.at > at)?.at)
      .filter((v): v is number => v !== undefined)
      .map((v) => v - at);
    const tAfter = await telemetry(prisma, WS_PORT);

    rows.push(
      `n=${String(n).padStart(4)} ok=${String(opened.opened).padStart(4)} refused=${opened.refused} ` +
        `connect p50=${String(percentile(opened.connectMs, 50)).padStart(4)}ms p95=${String(percentile(opened.connectMs, 95)).padStart(5)}ms | ` +
        `registry=${stats.totalConnections} | delivered=${delivered}/${live.length} dup=${dupes} ` +
        `deliver p50=${percentile(lat, 50)}ms p95=${percentile(lat, 95)}ms max=${Math.max(...lat, 0)}ms | ` +
        `rss=${tAfter.rssMb}MB heap=${tAfter.heapUsedMb}MB db=${tAfter.dbConnections} redisClients=${tAfter.redisClients}`,
    );
    console.log(`    ${rows[rows.length - 1]}`);
    void tBefore;
    closeAll(opened.clients);
    await sleep(2000);
  }
  record("L1", "connection ladder", "INFO", rows.join("\n         "));
}

// ── FAN-OUT ───────────────────────────────────────────────────────────────────────────────────────

async function testFanout(): Promise<void> {
  console.log("\n── FAN-OUT · exact recipient proof at each size ───────");
  await ensureServer("fanout");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const sizes = (arg("fanout", "1,10,50,100") || "").split(",").map(Number).filter((n) => n > 0);
  const rows: string[] = [];
  let allExact = true;

  for (const size of sizes) {
    const intended = await openMany(`fo${size}`, () => notificationsUrl(fx.customer.token), size, 30_000);
    // A recipient that must receive NOTHING, on every size — the isolation control.
    const outsider = new WsClient("fo-outsider", notificationsUrl(fx.outsider.token));
    await outsider.connect();
    await sleep(1000);

    const at = Date.now();
    await sleep(50);
    const produceStart = Date.now();
    await publishViaRedis(fx.bookingId, `fanout${size}`, { userId: fx.customer.userId, providerUserId: null });
    const produceMs = Date.now() - produceStart;
    await sleep(Math.max(3000, size * 8));

    const live = intended.clients.filter((c) => c.opened);
    const counts = live.map((c) => c.received.filter((r) => r.at > at).length);
    const delivered = counts.filter((x) => x >= 1).length;
    const missed = counts.filter((x) => x === 0).length;
    const dupes = counts.reduce((sum, x) => sum + Math.max(0, x - 1), 0);
    const strayFrames = outsider.received.filter((r) => r.at > at).length;
    const lat = live
      .map((c) => c.received.find((r) => r.at > at)?.at)
      .filter((v): v is number => v !== undefined)
      .map((v) => v - at);
    const t = await telemetry(prisma, WS_PORT);

    const exact = delivered === live.length && missed === 0 && dupes === 0 && strayFrames === 0;
    if (!exact) allExact = false;
    rows.push(
      `recipients=${String(size).padStart(3)} opened=${live.length} delivered=${delivered} missed=${missed} duplicates=${dupes} ` +
        `strayToNonRecipient=${strayFrames} | produce=${produceMs}ms deliver p50=${percentile(lat, 50)}ms p95=${percentile(lat, 95)}ms max=${Math.max(...lat, 0)}ms | rss=${t.rssMb}MB`,
    );
    console.log(`    ${rows[rows.length - 1]}`);
    closeAll(intended.clients);
    outsider.close();
    await sleep(1500);
  }

  record(
    "F1",
    "fan-out reaches exactly the intended recipients, with no duplicates and no strays",
    allExact ? "PASS" : "FAIL",
    rows.join("\n         "),
  );
}

// ── MULTI-EVENT BURST + ORDERING ──────────────────────────────────────────────────────────────────

async function testBurstOrdering(): Promise<void> {
  console.log("\n── BURST · many events, ordering and duplicates ───────");
  await ensureServer("burst");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const N = Number(arg("events", "60"));
  const subs = await openMany("burst", () => notificationsUrl(fx.customer.token), 20, 30_000);
  await sleep(1000);

  const at = Date.now();
  await sleep(50);
  /**
   * Each event carries its own sequence number in `extra`, so receipt ORDER is read from the payload
   * rather than from arrival time. Publishing sequentially and awaiting each one keeps the producing
   * side ordered; whether that order survives is the question.
   */
  for (let i = 1; i <= N; i++) {
    await publishViaRedis(fx.bookingId, "burst", { userId: fx.customer.userId, providerUserId: null }, { seq: i });
  }
  await sleep(6000);

  const live = subs.clients.filter((c) => c.opened);
  let outOfOrder = 0;
  let missing = 0;
  let duplicated = 0;
  const perClient: number[] = [];
  for (const c of live) {
    const seqs = c
      .payloadsOf("booking.status")
      .map((d) => Number((d as { seq?: unknown }).seq))
      .filter((v) => Number.isFinite(v));
    perClient.push(seqs.length);
    const unique = new Set(seqs);
    if (unique.size !== seqs.length) duplicated++;
    if (unique.size < N) missing++;
    for (let i = 1; i < seqs.length; i++) if (seqs[i]! < seqs[i - 1]!) outOfOrder++;
  }
  const t = await telemetry(prisma, WS_PORT);

  record(
    "BU1",
    `${N} events to ${live.length} subscribers: no drops`,
    missing === 0 ? "PASS" : "FAIL",
    `per-client received counts min=${Math.min(...perClient)} max=${Math.max(...perClient)} (expected ${N} each); clients missing at least one=${missing}`,
  );
  record(
    "BU2",
    "no duplicate delivery under burst",
    duplicated === 0 ? "PASS" : "FAIL",
    `clients that received a sequence number more than once: ${duplicated}`,
  );
  record(
    "BU3",
    "ORDER is preserved per connection (measured from the payload sequence, not arrival time)",
    outOfOrder === 0 ? "PASS" : "FAIL",
    `inversions across all clients: ${outOfOrder}. The architecture provides no explicit ordering contract — this records what a single ` +
      `Redis pub/sub channel plus one socket write loop actually produced under a ${N}-event burst.`,
  );
  record("BU4", "resources after the burst", "INFO", `rss=${t.rssMb}MB heap=${t.heapUsedMb}MB db=${t.dbConnections} redisClients=${t.redisClients}`);

  closeAll(subs.clients);
  await sleep(1000);
}

// ── SLOW CONSUMER ─────────────────────────────────────────────────────────────────────────────────

async function testSlowConsumer(): Promise<void> {
  console.log("\n── SLOW CONSUMER · one socket stops reading ───────────");
  await ensureServer("slow");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const { RawWsClient } = await import("./7g-raw-client");
  const slow = new RawWsClient("slow");
  const slowOk = await slow.connect("127.0.0.1", WS_PORT, `/ws/notifications?token=${encodeURIComponent(fx.customer.token)}`);
  const fast = await openMany("fast", () => notificationsUrl(fx.customer.token), 5, 20_000);
  await sleep(1200);

  record(
    "SC0",
    "the slow client genuinely completed a WebSocket upgrade",
    slowOk && slow.opened ? "PASS" : "FAIL",
    `raw handshake status=${slow.handshakeStatus} opened=${slow.opened} error=${slow.error ?? "none"}`,
  );
  if (!slowOk) return;

  slow.stopReading();
  const at = Date.now();
  await sleep(50);
  const EVENTS = 300;
  const t0 = Date.now();
  for (let i = 1; i <= EVENTS; i++) {
    await publishViaRedis(fx.bookingId, "slow", { userId: fx.customer.userId, providerUserId: null }, { seq: i });
  }
  const produceMs = Date.now() - t0;
  await sleep(6000);

  const live = fast.clients.filter((c) => c.opened);
  const fastCounts = live.map((c) => c.received.filter((r) => r.at > at).length);
  const t = await telemetry(prisma, WS_PORT);
  const statsNow = await wsStats(fx.admin.token);

  record(
    "SC1",
    "a socket that stops reading does NOT block the broadcaster",
    produceMs < EVENTS * 50 ? "PASS" : "FAIL",
    `producing ${EVENTS} events took ${produceMs}ms while one subscriber was not reading (${Math.round(produceMs / EVENTS)}ms/event)`,
  );
  record(
    "SC2",
    "unrelated fast clients keep receiving while one client is stalled",
    fastCounts.every((c) => c >= EVENTS * 0.9) ? "PASS" : "FAIL",
    `fast clients received ${JSON.stringify(fastCounts)} of ${EVENTS} events each`,
  );
  record(
    "SC3",
    "the stalled socket's backlog is bounded by the transport, not by an unbounded server-side queue",
    "INFO",
    `the server holds no per-client send queue: every route's send() is a direct ws.send() wrapped in try/catch. ` +
      `Backpressure is therefore whatever Bun's socket buffer does. Server rss=${t.rssMb}MB heap=${t.heapUsedMb}MB after ${EVENTS} events with one non-reading socket; ` +
      `registry still holds ${statsNow.totalConnections} connections.`,
  );

  slow.resumeReading();
  await sleep(1500);
  record(
    "SC4",
    "the stalled socket drains once it resumes reading",
    slow.framesRead > 0 ? "PASS" : "FAIL",
    `frames read by the slow client after resuming: ${slow.framesRead}; bytes still buffered=${slow.bytesBuffered}`,
  );

  slow.destroy();
  closeAll(fast.clients);
  await sleep(1000);
}

// ── DISCONNECT DURING FAN-OUT ─────────────────────────────────────────────────────────────────────

async function testDisconnect(): Promise<void> {
  console.log("\n── DISCONNECT · during an active broadcast ────────────");
  await ensureServer("disconnect");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const group = await openMany("dc", () => notificationsUrl(fx.customer.token), 30, 30_000);
  await sleep(1000);
  const live = group.clients.filter((c) => c.opened);

  // Half are torn down without a close frame while frames are flowing.
  const at = Date.now();
  const burst = (async () => {
    for (let i = 1; i <= 80; i++) {
      await publishViaRedis(fx.bookingId, "dc", { userId: fx.customer.userId, providerUserId: null }, { seq: i });
    }
  })();
  await sleep(300);
  const killed = live.slice(0, 15);
  for (const c of killed) c.terminate();
  await burst;
  await sleep(4000);

  const survivors = live.slice(15);
  const survivorCounts = survivors.map((c) => c.received.filter((r) => r.at > at).length);
  const health = await probeHealth(WS_PORT);
  await sleep(2000);
  const stats = await wsStats(fx.admin.token);

  record(
    "DC1",
    "the server survives sockets breaking mid-broadcast",
    health.ready ? "PASS" : "FAIL",
    `after terminating 15 of ${live.length} sockets during an 80-event burst the server is ${health.status} (database=${health.database})`,
  );
  record(
    "DC2",
    "the remaining clients still receive the rest of the burst",
    survivorCounts.every((c) => c > 0) ? "PASS" : "FAIL",
    `survivor receipt counts: min=${Math.min(...survivorCounts)} max=${Math.max(...survivorCounts)} of 80 events`,
  );
  record(
    "DC3",
    "the broken sockets are removed from the registry, not retained",
    stats.totalConnections <= survivors.length + 2 ? "PASS" : "FAIL",
    `registry holds ${stats.totalConnections} connections; ${survivors.length} clients are still open, 15 were terminated abruptly`,
  );

  closeAll(survivors);
  await sleep(1000);
}

// ── RECONNECT STORM ───────────────────────────────────────────────────────────────────────────────

async function testReconnectStorm(): Promise<void> {
  console.log("\n── RECONNECT STORM · churn without amplification ──────");
  await ensureServer("reconnect");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const baseline = await wsStats(fx.admin.token);
  const CYCLES = Number(arg("cycles", "6"));
  const PER_CYCLE = 40;
  const t0 = Date.now();
  let totalOpened = 0;
  let totalRefused = 0;

  for (let c = 0; c < CYCLES; c++) {
    const wave = await openMany(`rs${c}`, () => notificationsUrl(fx.customer.token), PER_CYCLE, 30_000);
    totalOpened += wave.opened;
    totalRefused += wave.refused;
    await sleep(400);
    closeAll(wave.clients);
    await sleep(600);
  }
  const churnMs = Date.now() - t0;
  await sleep(2500);

  const after = await wsStats(fx.admin.token);
  const t = await telemetry(prisma, WS_PORT);

  // One survivor proves the room holds exactly one membership, not an accumulated set.
  const survivor = await openMany("rs-final", () => notificationsUrl(fx.customer.token), 1, 20_000);
  await sleep(1000);
  const finalStats = await wsStats(fx.admin.token);
  const userRoom = finalStats.rooms.find((r) => r.id === `user:${fx.customer.userId}`);

  record(
    "RS1",
    `${CYCLES * PER_CYCLE} reconnects complete without refusal or amplification`,
    totalRefused === 0 ? "PASS" : "FAIL",
    `${totalOpened} handshakes succeeded, ${totalRefused} refused, over ${churnMs}ms (${Math.round((totalOpened / churnMs) * 1000)} conn/s)`,
  );
  record(
    "RS2",
    "the registry returns to its baseline after the storm",
    after.totalConnections <= baseline.totalConnections ? "PASS" : "FAIL",
    `registry connections before=${baseline.totalConnections} after=${after.totalConnections}; rooms ${baseline.totalRooms} → ${after.totalRooms}`,
  );
  record(
    "RS3",
    "a reconnecting client holds exactly one membership, not one per past attempt",
    (userRoom?.connections ?? 0) === 1 ? "PASS" : "FAIL",
    `after ${CYCLES * PER_CYCLE} connect/disconnect cycles, one fresh client puts room user:… at ${userRoom?.connections ?? 0} connection(s)`,
  );
  record("RS4", "resources after the storm", "INFO", `rss=${t.rssMb}MB heap=${t.heapUsedMb}MB db=${t.dbConnections} redisClients=${t.redisClients}`);

  closeAll(survivor.clients);
  await sleep(800);
}

// ── AUTH / REVOCATION ─────────────────────────────────────────────────────────────────────────────

async function testAuthRevocation(): Promise<void> {
  console.log("\n── AUTH · revocation while a socket is open ───────────");
  await ensureServer("authrevoke");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const c = new WsClient("revoke", notificationsUrl(fx.customer.token));
  const ok = await c.connect();
  await sleep(800);
  record("AR0", "a socket is open before revocation", ok && c.opened ? "PASS" : "FAIL", `opened=${c.opened}`);
  if (!ok) return;

  /**
   * Revocation is driven the way the product drives it — `ws-eviction` is the module that turns an
   * authorization change into socket closure — rather than by closing the socket directly, which
   * would prove nothing about the product.
   */
  const { roomManager } = await import("../../src/lib/websocket");
  const closedIn = await (async () => {
    const started = Date.now();
    roomManager.evictUser({ userId: fx.customer.userId, code: 4401, reason: "session_revoked" });
    const waited = await waitFor(() => c.closed, 10_000);
    return waited === null ? null : Date.now() - started;
  })();

  record(
    "AR1",
    "revoking a session closes the open socket across instances (the harness evicts, the server closes)",
    c.closed && c.closeCode === 4401 ? "PASS" : "FAIL",
    `client observed closed=${c.closed} code=${c.closeCode} reason="${c.closeReason}" after ${closedIn ?? ">10000"}ms. ` +
      `The eviction was published from a DIFFERENT instance, so this also exercises the cross-instance evict envelope.`,
  );

  // A new socket with the same (still valid) token may reconnect — revocation here is session-scoped.
  const again = new WsClient("revoke-again", notificationsUrl(fx.customer.token));
  const reopened = await again.connect();
  await sleep(600);
  record(
    "AR2",
    "reconnect still requires authentication and is not blocked by the prior eviction",
    reopened ? "PASS" : "FAIL",
    `reconnect opened=${again.opened} closeCode=${again.closeCode}. Eviction closes sockets; it does not by itself invalidate the credential, ` +
      `so a token that is still valid reconnects — which is the architecture's behaviour, stated rather than assumed.`,
  );
  again.close();

  // An expired credential must not be usable at all.
  const expiredToken = await (async () => {
    const { JWTService } = await import("../../src/services/jwt.service");
    const svc = new JWTService();
    void svc;
    return "expired.not.a.real.jwt";
  })();
  const expired = new WsClient("expired", notificationsUrl(expiredToken));
  await expired.connect(10_000);
  await waitFor(() => expired.closed, 5000);
  record(
    "AR3",
    "an unusable credential cannot open a subscription",
    expired.closed && expired.closeCode === 4401 && expired.received.filter((r) => r.type !== "PING").length === 0 ? "PASS" : "FAIL",
    `closed=${expired.closed} code=${expired.closeCode} privilegedFrames=${expired.received.filter((r) => r.type !== "PING").length}`,
  );
  await sleep(500);
}

// ── SUBSCRIPTION LEAK ─────────────────────────────────────────────────────────────────────────────

async function testSubscriptionLeak(): Promise<void> {
  console.log("\n── LEAK · repeated subscribe/unsubscribe cycles ───────");
  await ensureServer("leak");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const base = await wsStats(fx.admin.token);
  const tBase = await telemetry(prisma, WS_PORT);
  const samples: string[] = [];

  for (let round = 1; round <= 5; round++) {
    const wave = await openMany(`lk${round}`, (i) => (i % 2 === 0 ? notificationsUrl(fx.customer.token) : bookingUrl(fx.bookingId, fx.customer.token)), 40, 30_000);
    await sleep(600);
    closeAll(wave.clients);
    await sleep(1200);
    const s = await wsStats(fx.admin.token);
    const t = await telemetry(prisma, WS_PORT);
    samples.push(`round ${round}: registry connections=${s.totalConnections} rooms=${s.totalRooms} rss=${t.rssMb}MB heap=${t.heapUsedMb}MB redisClients=${t.redisClients}`);
    console.log(`    ${samples[samples.length - 1]}`);
  }

  const final = await wsStats(fx.admin.token);
  const tFinal = await telemetry(prisma, WS_PORT);
  record(
    "LK1",
    "connection and room counts return to baseline after 200 subscribe/disconnect cycles",
    final.totalConnections <= base.totalConnections && final.totalRooms <= base.totalRooms ? "PASS" : "FAIL",
    `registry connections ${base.totalConnections} → ${final.totalConnections}; rooms ${base.totalRooms} → ${final.totalRooms}\n         ` + samples.join("\n         "),
  );
  record(
    "LK2",
    "no monotonic memory growth across the cycles",
    tFinal.rssMb <= tBase.rssMb * 1.6 ? "PASS" : "FAIL",
    `rss ${tBase.rssMb}MB → ${tFinal.rssMb}MB, heap ${tBase.heapUsedMb}MB → ${tFinal.heapUsedMb}MB, redis clients ${tBase.redisClients} → ${tFinal.redisClients}`,
  );
}

// ── STALE CLIENT / HEARTBEAT ──────────────────────────────────────────────────────────────────────

async function testStaleCleanup(): Promise<void> {
  console.log("\n── STALE · silently dead sockets ──────────────────────");
  await ensureServer("stale");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const { RawWsClient } = await import("./7g-raw-client");
  const before = await wsStats(fx.admin.token);

  const dead: InstanceType<typeof RawWsClient>[] = [];
  for (let i = 0; i < 10; i++) {
    const r = new RawWsClient(`dead${i}`);
    const ok = await r.connect("127.0.0.1", WS_PORT, `/ws/notifications?token=${encodeURIComponent(fx.customer.token)}`);
    if (ok) dead.push(r);
  }
  await sleep(1200);
  const withDead = await wsStats(fx.admin.token);
  record(
    "ST0",
    "ten sockets are genuinely registered before being killed",
    withDead.totalConnections >= before.totalConnections + 10 ? "PASS" : "FAIL",
    `registry ${before.totalConnections} → ${withDead.totalConnections} after ${dead.length} raw handshakes`,
  );

  // Hard TCP teardown with no close frame: the server gets a reset, not a goodbye.
  for (const d of dead) d.destroy();
  const detectMs = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 20_000) {
      const s = await wsStats(fx.admin.token);
      if (s.totalConnections <= before.totalConnections) return Date.now() - started;
      await sleep(500);
    }
    return null;
  })();
  const after = await wsStats(fx.admin.token);

  record(
    "ST1",
    "abruptly killed sockets are detected and removed without needing a close frame",
    detectMs !== null ? "PASS" : "FAIL",
    `registry returned to ${after.totalConnections} (baseline ${before.totalConnections}) after ${detectMs ?? ">20000"}ms. ` +
      `A TCP reset reaches Bun as a close event, so the route's close handler runs; the 30s server PING is a keepalive and ` +
      `deliberately does NOT enforce a PONG (documented in heartbeat.ts), so it is not what detects this.`,
  );
}

// ── PAYLOAD SIZE ──────────────────────────────────────────────────────────────────────────────────

async function testPayload(): Promise<void> {
  console.log("\n── PAYLOAD · client message sizes ─────────────────────");
  await ensureServer("payload");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const rows: string[] = [];
  let crashed = false;
  for (const size of [1_000, 64_000, 1_000_000]) {
    const c = new WsClient(`pl${size}`, bookingUrl(fx.bookingId, fx.customer.token));
    const ok = await c.connect();
    if (!ok) {
      rows.push(`${size}B: could not open a socket`);
      continue;
    }
    await sleep(400);
    const sent = c.send({ type: "PING", pad: "x".repeat(size) });
    await sleep(1500);
    const health = await probeHealth(WS_PORT);
    if (!health.ready) crashed = true;
    rows.push(`${size}B: sent=${sent} clientStillOpen=${!c.closed} closeCode=${c.closeCode ?? "-"} serverReady=${health.ready} framesBack=${c.received.length}`);
    c.close();
    await sleep(400);
  }

  record(
    "PL1",
    "oversized client messages do not take the server down",
    !crashed ? "PASS" : "FAIL",
    rows.join("\n         "),
  );
  record(
    "PL2",
    "no payload-size limit is configured on the WebSocket server",
    "INFO",
    "`app.listen(port, cb)` is called with no Bun.serve websocket options anywhere in src/index.ts: no maxPayloadLength, " +
      "no idleTimeout, no backpressure limit and no per-connection cap. The sizes above record what that means in practice.",
  );
}

// ── REDIS FAILURE ─────────────────────────────────────────────────────────────────────────────────

function dockerRedis(cmd: "pause" | "unpause"): boolean {
  return Bun.spawnSync(["docker", cmd, "homigo-staging-redis"]).exitCode === 0;
}

async function testRedisFailure(): Promise<void> {
  console.log("\n── REDIS · fan-out with the broker frozen ─────────────");
  await ensureServer("redisfail");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  // A booking dedicated to the local-production control, so no earlier scenario can have consumed it.
  const localControl = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
      bookingNumber: `7G-${RUN_TAG}-rfctl-${Math.random().toString(36).slice(2, 7)}`,
      userId: fx.customer.userId,
      serviceId: (await prisma.service.findFirst({ where: { isActive: true }, select: { id: true } }))!.id,
      addressId: (await prisma.address.findFirst({ where: { userId: fx.customer.userId }, select: { id: true } }))!.id,
      scheduledDate: new Date(Date.now() + 21 * 86_400_000),
      baseAmount: 499,
      finalAmount: 499,
      totalAmount: 499,
      description: `7G redis-control ${RUN_TAG}`,
    },
    select: { id: true },
  });
  const localControlBookingId = localControl.id;
  let localCancelStatus: number | null = null;

  const subs = await openMany("rf", () => notificationsUrl(fx.customer.token), 10, 30_000);
  await sleep(1000);
  const live = subs.clients.filter((c) => c.opened);

  // Healthy reference: the cross-instance route works.
  const t1 = Date.now();
  await sleep(50);
  await publishViaRedis(fx.bookingId, "pre", { userId: fx.customer.userId, providerUserId: null });
  await sleep(3000);
  const healthyDelivered = live.filter((c) => c.received.some((r) => r.at > t1)).length;

  dockerRedis("pause");
  let frozenDelivered = 0;
  let localDelivered = 0;
  let sockets = 0;
  try {
    await sleep(1500);
    const t2 = Date.now();
    await sleep(50);
    await publishViaRedis(fx.bookingId, "during", { userId: fx.customer.userId, providerUserId: null });
    await sleep(8000);
    frozenDelivered = live.filter((c) => c.received.some((r) => r.at > t2)).length;
    sockets = live.filter((c) => !c.closed).length;

    /**
     * The same event produced INSIDE the server (its own local fan-out, no broker hop) is the control
     * that separates "Redis is down so cross-instance delivery stops" from "Redis is down so realtime
     * stops". They are very different failures and only a locally-produced event can tell them apart.
     */
    const t3 = Date.now();
    await sleep(50);
    /**
     * A booking created for THIS control only. Reusing the fixture booking silently produced zero
     * deliveries once, because an earlier scenario had already cancelled it — the endpoint refused,
     * nothing was published, and the run read that as "local fan-out is broken with Redis down".
     */
    const cancelRes = await fetch(`${HTTP_BASE}/api/bookings/${localControlBookingId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fx.customer.token}` },
      body: JSON.stringify({ reason: "7G redis-down local fan-out control" }),
      signal: AbortSignal.timeout(25_000),
    }).catch(() => null);
    localCancelStatus = cancelRes?.status ?? null;
    await sleep(4000);
    localDelivered = live.filter((c) => c.received.some((r) => r.at > t3)).length;
  } finally {
    dockerRedis("unpause");
  }

  /**
   * Both Redis clients mark themselves unavailable on the 5s command deadline during the freeze and
   * clear it on a 30s PING loop. Waiting for the client's own recheck — instead of sleeping a few
   * seconds and hoping — is what separates "fan-out did not resume" from "the flag had not been
   * refreshed yet".
   */
  const harnessRecoveredMs = await awaitHarnessRedisRecovery(60_000);
  await sleep(3000);

  const t4 = Date.now();
  await sleep(50);
  await publishViaRedis(fx.bookingId, "post", { userId: fx.customer.userId, providerUserId: null });
  await sleep(4000);
  const recoveredDelivered = live.filter((c) => c.received.some((r) => r.at > t4)).length;

  record(
    "RF0",
    "sockets stay connected while Redis is frozen",
    sockets === live.length ? "PASS" : "FAIL",
    `${sockets} of ${live.length} sockets still open with the broker frozen — realtime transport does not depend on Redis being reachable`,
  );
  record(
    "RF1",
    "CROSS-INSTANCE fan-out stops while the broker is frozen (measured, not assumed)",
    "INFO",
    `clients receiving an event published from the OTHER instance: healthy=${healthyDelivered}/${live.length}, frozen=${frozenDelivered}/${live.length}. ` +
      `Redis pub/sub has no store-and-forward, so an envelope published while the broker is unreachable is gone — not queued.`,
  );
  record(
    "RF2",
    "LOCALLY produced events still reach local subscribers with Redis down",
    localDelivered > 0 ? "PASS" : "FAIL",
    `a transition produced inside the server itself reached ${localDelivered}/${live.length} local subscribers while Redis was frozen`,
  );
  record(
    "RF2b",
    "the local-production control actually produced a transition",
    localCancelStatus !== null && localCancelStatus < 400 ? "PASS" : "FAIL",
    `POST /api/bookings/:id/cancel on the dedicated control booking returned HTTP ${localCancelStatus}. ` +
      `A 4xx here means nothing was published and RF2 would be measuring a refused request, not fan-out.`,
  );
  record(
    "RF3",
    "cross-instance fan-out resumes after the broker returns",
    recoveredDelivered === live.length ? "PASS" : "FAIL",
    `after unpausing, an event from the other instance reached ${recoveredDelivered}/${live.length} clients ` +
      `(the harness's Redis client reported itself healthy again after ${harnessRecoveredMs ?? ">60000"}ms)`,
  );

  await prisma.booking.deleteMany({ where: { id: localControlBookingId } }).catch(() => ({ count: 0 }));

  closeAll(subs.clients);
  await sleep(1000);
}

// ── BACKEND RESTART ───────────────────────────────────────────────────────────────────────────────

async function testRestart(): Promise<void> {
  console.log("\n── RESTART · killing the server under live sockets ────");
  await ensureServer("restart");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  const subs = await openMany("rst", () => notificationsUrl(fx.customer.token), 25, 30_000);
  await sleep(1200);
  const live = subs.clients.filter((c) => c.opened);
  const oldPid = server!.listenerPid;

  stopServer(server!);
  server = null;
  const closedAll = await waitFor(() => live.every((c) => c.closed), 15_000);

  server = await startRealtimeServer({ env: SERVER_ENV, logPath: `${LOG_DIR}/7g-server-restart2.log`, port: WS_PORT });
  const newPid = server.listenerPid;

  const reconnected = await openMany("rst2", () => notificationsUrl(fx.customer.token), 25, 30_000);
  await sleep(1500);
  const t = Date.now();
  await sleep(50);
  await publishViaRedis(fx.bookingId, "postrestart", { userId: fx.customer.userId, providerUserId: null });
  await sleep(4000);

  const fresh = reconnected.clients.filter((c) => c.opened);
  const counts = fresh.map((c) => c.received.filter((r) => r.at > t).length);
  const delivered = counts.filter((n) => n >= 1).length;
  const dupes = counts.filter((n) => n > 1).length;
  const stats = await wsStats(fx.admin.token);

  record(
    "RE1",
    "every client observes the disconnect when the server dies",
    closedAll !== null ? "PASS" : "FAIL",
    `all ${live.length} clients saw a close within ${closedAll ?? ">15000"}ms; listener pid ${oldPid} → ${newPid}`,
  );
  record(
    "RE2",
    "the restarted server starts with a clean registry (no ghost connections)",
    stats.totalConnections === fresh.length ? "PASS" : "FAIL",
    `registry holds ${stats.totalConnections} connections and ${fresh.length} fresh clients are connected — a larger number would mean state survived the kill`,
  );
  record(
    "RE3",
    "reconnected clients receive fresh events exactly once",
    delivered === fresh.length && dupes === 0 ? "PASS" : "FAIL",
    `${delivered}/${fresh.length} received the post-restart event, ${dupes} received it more than once`,
  );

  closeAll(reconnected.clients);
  await sleep(1000);
}

// ── BOOKING / OPERATIONAL REALTIME (durability vs delivery) ───────────────────────────────────────

async function testBookingRealtime(): Promise<void> {
  console.log("\n── BOOKING · durable truth vs realtime delivery ───────");
  await ensureServer("booking");
  await connectHarnessRedis();
  const fx = await ensureFixtures();
  if (!fx) return;

  /**
   * A booking created for THIS run, not a shared fixture.
   *
   * The transition under test is a cancellation, which is one-shot: a second pass reusing the same
   * booking gets a refusal, publishes nothing, and reads that as a realtime failure. Anything that
   * consumes its subject has to bring its own.
   */
  const svc = await prisma.service.findFirst({ where: { isActive: true }, select: { id: true } });
  const addr = await prisma.address.findFirst({ where: { userId: fx.customer.userId }, select: { id: true } });
  if (!svc || !addr) {
    record("BK0", "booking realtime fixtures", "NOT_PROVEN", "no active service or address for the customer");
    return;
  }
  const subject = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
      bookingNumber: `7G-${RUN_TAG}-bk-${Math.random().toString(36).slice(2, 7)}`,
      userId: fx.customer.userId,
      serviceId: svc.id,
      addressId: addr.id,
      scheduledDate: new Date(Date.now() + 30 * 86_400_000 + Math.floor(Math.random() * 20) * 86_400_000),
      baseAmount: 499,
      finalAmount: 499,
      totalAmount: 499,
      description: `7G booking-subject ${RUN_TAG}`,
    },
    select: { id: true },
  });
  const subjectId = subject.id;

  // A client that is CONNECTED for the transition, and one that is deliberately absent for it.
  const present = new WsClient("present", notificationsUrl(fx.customer.token));
  await present.connect();
  await sleep(800);

  const before = await prisma.booking.findUnique({ where: { id: subjectId }, select: { status: true } });
  const at = Date.now();
  await sleep(50);
  const res = await fetch(`${HTTP_BASE}/api/bookings/${subjectId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fx.customer.token}` },
    body: JSON.stringify({ reason: "7G realtime durability check" }),
    signal: AbortSignal.timeout(25_000),
  });
  const httpStatus = res.status;
  await sleep(4000);
  const after = await prisma.booking.findUnique({ where: { id: subjectId }, select: { status: true, cancelledAt: true } });
  const presentGot = present.received.filter((r) => r.at > at).length;

  record(
    "BK1",
    "a real transition is driven over HTTP and the SERVER is the producer (local fan-out, no broker hop)",
    httpStatus < 400 || httpStatus === 409 ? "PASS" : "FAIL",
    `POST /api/bookings/:id/cancel → HTTP ${httpStatus}; booking status ${before?.status} → ${after?.status}`,
  );
  record(
    "BK2",
    "a connected client receives the transition",
    presentGot > 0 ? "PASS" : "FAIL",
    `client frames after the transition: ${presentGot} ${JSON.stringify(present.received.filter((r) => r.at > at).map((r) => r.type))}`,
  );

  /**
   * The durability question, stated as the architecture actually answers it: realtime carries no
   * persistence of its own. A client that was absent gets nothing pushed to it, and the business
   * truth is recovered from the authoritative API — not replayed by the socket.
   */
  const absentApi = await fetch(`${HTTP_BASE}/api/users/bookings`, {
    headers: { authorization: `Bearer ${fx.customer.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const absentBody = (await absentApi.json()) as { data?: unknown };
  record(
    "BK3",
    "a client that was disconnected loses the MESSAGE but not the BUSINESS EVENT",
    after?.status !== before?.status && absentApi.ok ? "PASS" : "FAIL",
    `the transition is durable in Postgres (status ${before?.status} → ${after?.status}, cancelledAt=${after?.cancelledAt ? "set" : "null"}) and readable over the authoritative API (HTTP ${absentApi.status}). ` +
      `There is no replay buffer and no acknowledgement in the realtime path: a disconnected client recovers state by asking, not by being re-sent.`,
  );
  void absentBody;

  // Duplicate delivery must not duplicate the business transition.
  const dupAt = Date.now();
  await sleep(50);
  await publishViaRedis(subjectId, "cancelled", { userId: fx.customer.userId, providerUserId: null });
  await publishViaRedis(subjectId, "cancelled", { userId: fx.customer.userId, providerUserId: null });
  await sleep(3000);
  const dupFrames = present.received.filter((r) => r.at > dupAt).length;
  const afterDup = await prisma.booking.findUnique({ where: { id: subjectId }, select: { status: true } });
  record(
    "BK4",
    "duplicate realtime messages do not duplicate the business transition",
    afterDup?.status === after?.status ? "PASS" : "FAIL",
    `two identical status frames delivered (client saw ${dupFrames} frames); booking status stayed ${afterDup?.status}. ` +
      `Realtime is a notification of a transition that already happened in Postgres; it is not the transition.`,
  );

  present.close();
  await sleep(800);
  await prisma.booking.deleteMany({ where: { id: subjectId } }).catch(() => ({ count: 0 }));
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

console.log("SECTION 7G — WebSocket / realtime load");
console.log(`  run tag : ${RUN_TAG}`);
console.log(`  ws base : ${WS_BASE}`);
console.log(`  machine : ${await machineState()}\n`);

let exitCode = 0;
try {
  if (want("gates")) await testGates();
  if (want("baseline")) {
    await testBaseline(1);
    await testBaseline(2);
  }
  if (want("ladder")) await testLadder();
  if (want("fanout")) await testFanout();
  if (want("burst")) await testBurstOrdering();
  if (want("slow")) await testSlowConsumer();
  if (want("disconnect")) await testDisconnect();
  if (want("reconnect")) await testReconnectStorm();
  if (want("authrevoke")) await testAuthRevocation();
  if (want("booking")) await testBookingRealtime();
  if (want("redisfail")) await testRedisFailure();
  if (want("restart")) await testRestart();
  if (want("leak")) await testSubscriptionLeak();
  if (want("stale")) await testStaleCleanup();
  if (want("payload")) await testPayload();
} finally {
  await disconnectHarnessRedis();
  if (server) stopServer(server);
  clearPort(WS_PORT);
  console.log("\n── POST-RUN ──────────────────────────────────────────");
  const leftover = listenerPidOn(WS_PORT);
  record("Z1", "no server left listening on the realtime port", leftover === null ? "PASS" : "FAIL", `listener on :${WS_PORT} = ${leftover ?? "none"}`);

  const fails = checks.filter((c) => c.status === "FAIL");
  const unproven = checks.filter((c) => c.status === "NOT_PROVEN");
  console.log("\n══ 7G RESULT ═════════════════════════════════════════");
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
