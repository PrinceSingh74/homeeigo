/**
 * PHASE 9 - Capability 12, the admin HTTP surface for Phase-9 intelligence.
 *
 * Runs ONLY on the isolated homigo_p39 database and aborts otherwise.
 *
 * Every request below goes through the real Elysia app, the real auth plugin and the real admin RBAC
 * middleware. Nothing is mocked: a 403 here is the middleware refusing, not a stub returning a
 * number chosen by the test.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  prisma, dbReachable, seedAdversarialFixtures, cleanupAdversarialFixtures, bearer, type AdvCtx,
} from "./helpers/adversarial-fixtures";
import app from "../index";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";

const RUN_ID = `intel-${Date.now().toString(36)}`;
let ctx: AdvCtx;

const BRIEF = "http://localhost/api/admin/intelligence/executive-brief";
const SCHEDULE = "http://localhost/api/admin/intelligence/report-schedule";
const RECIPIENTS = "http://localhost/api/admin/intelligence/report-recipients";

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, payments, wallet, ledger, notifications, outbox, jobs, approvals, flags] =
    await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.walletTransaction.count(),
      prisma.ledgerEntry.count(), prisma.notification.count(), prisma.eventOutbox.count(),
      prisma.scheduledJob.count(), prisma.aiToolApproval.count(),
      prisma.platformFeatureFlag.count(),
    ]);
  return { bookings, payments, wallet, ledger, notifications, outbox, jobs, approvals, flags };
}
let baseline: Counts;

async function get(url: string, token?: string) {
  const res = await app.handle(
    new Request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
  );
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body as { success?: boolean; data?: unknown; code?: string } | null };
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  if (!(await dbReachable())) throw new Error("PostgreSQL unreachable");
  ctx = await seedAdversarialFixtures(RUN_ID);
  baseline = await snapshot();
}, 120_000);

afterAll(async () => {
  await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

describe("the routes exist, and they are the only ones added", () => {
  test("all three resolve to an existing permission, none invented", () => {
    expect(resolveAdminRoutePermission("GET", "/api/admin/intelligence/executive-brief"))
      .toEqual({ resource: "ANALYTICS", action: "READ" });
    expect(resolveAdminRoutePermission("GET", "/api/admin/intelligence/report-schedule"))
      .toEqual({ resource: "ANALYTICS", action: "READ" });
    // Recipients name people, so they sit with admin-user reads rather than analytics.
    expect(resolveAdminRoutePermission("GET", "/api/admin/intelligence/report-recipients"))
      .toEqual({ resource: "ADMIN_USERS", action: "READ" });
  });

  /**
   * Every resource and action used is one the `AdminResource` / `AdminAction` enum already had.
   *
   * Checked through the resolver rather than by grepping the table, because the resolver is what the
   * middleware actually consults — a rule that never matches would pass a grep and fail a request.
   */
  test("no new AdminResource or AdminAction value was introduced", async () => {
    const RESOURCES = new Set([
      "USERS", "PAYMENTS", "WALLET", "BOOKINGS", "DISPUTES", "CAMPAIGNS", "GIFT_CARDS",
      "MEMBERSHIPS", "ANALYTICS", "SETTINGS", "AUDIT_LOGS", "ADMIN_USERS",
    ]);
    const ACTIONS = new Set([
      "CREATE", "READ", "UPDATE", "DELETE", "APPROVE", "REJECT", "EXPORT",
      "IMPERSONATE", "FORCE_LOGOUT",
    ]);
    for (const url of [BRIEF, SCHEDULE, RECIPIENTS]) {
      const p = resolveAdminRoutePermission("GET", new URL(url).pathname);
      expect(p).not.toBeNull();
      expect(RESOURCES.has(p!.resource)).toBe(true);
      expect(ACTIONS.has(p!.action)).toBe(true);
    }
    // The route module declares no permission of its own; the table is the single source.
    const src = await Bun.file(`${import.meta.dir}/../routes/admin-intelligence.ts`).text();
    expect(src.includes("requiredPermission")).toBe(false);
    expect(src.includes("hasPermission")).toBe(false);
  });
});

describe("401 / 403: the middleware refuses, and the UI cannot widen it", () => {
  for (const [name, url] of [["brief", BRIEF], ["schedule", SCHEDULE], ["recipients", RECIPIENTS]] as const) {
    test(`${name} with no token is 401`, async () => {
      const r = await get(url);
      expect(r.status).toBe(401);
      expect(r.body?.data).toBeUndefined();
    });

    test(`${name} with a customer token is refused`, async () => {
      const r = await get(url, bearer(ctx.customerA));
      expect([401, 403]).toContain(r.status);
      expect(r.body?.data).toBeUndefined();
    });

    test(`${name} with a forged token is 401`, async () => {
      const r = await get(url, "not.a.real.jwt");
      expect(r.status).toBe(401);
      expect(r.body?.data).toBeUndefined();
    });
  }

  /**
   * A user with the ADMIN role but no AdminUser row is the interesting case: authentication
   * succeeds and authorisation must still fail, because `adminContext` is null.
   */
  test("an ADMIN-role user with no admin record gets no intelligence", async () => {
    const r = await get(BRIEF, bearer(ctx.legacyAdmin));
    expect(r.status).toBe(403);
    expect(r.body?.code).toBe("FORBIDDEN");
    expect(r.body?.data).toBeUndefined();
  });

  test("a support admin without ANALYTICS/READ cannot read the brief", async () => {
    const r = await get(BRIEF, bearer(ctx.supportAdmin));
    expect(r.status).toBe(403);
    expect(r.body?.data).toBeUndefined();
  });

  test("a finance admin without ADMIN_USERS/READ cannot list recipients", async () => {
    const r = await get(RECIPIENTS, bearer(ctx.financeAdmin));
    expect(r.status).toBe(403);
    expect(r.body?.data).toBeUndefined();
  });
});

describe("an authorized admin gets a real brief, and nothing is fabricated", () => {
  test("the super admin can read the brief", async () => {
    const r = await get(BRIEF, bearer(ctx.superAdmin));
    expect(r.status).toBe(200);
    const d = r.body!.data as {
      items: Array<{ kind: string; label: string; value: unknown; state: string; source: string }>;
      state: string; narrative: { text: string; generatedBy: string };
      staleSources: string[]; structuralGaps: string[]; versions: Record<string, unknown>;
    };
    expect(d.items.length).toBeGreaterThan(20);
    expect(["GENERATED", "STALE", "INCOMPLETE"]).toContain(d.state);
    expect(d.narrative.generatedBy).toBe("DETERMINISTIC");
  }, 60_000);

  /**
   * The three strings that must never reach an executive's screen. Checked against the serialised
   * payload, because that is exactly what the browser receives.
   */
  test("the payload contains no undefined, NaN or [object Object]", async () => {
    const r = await get(BRIEF, bearer(ctx.superAdmin));
    const raw = JSON.stringify(r.body);
    expect(raw.includes("[object Object]")).toBe(false);
    expect(raw.includes("NaN")).toBe(false);
    expect(raw.includes("undefined")).toBe(false);
  }, 60_000);

  test("no item carries a NaN or Infinity value", async () => {
    const r = await get(BRIEF, bearer(ctx.superAdmin));
    const d = r.body!.data as { items: Array<{ value: unknown; confidence: number | null }> };
    for (const i of d.items) {
      if (typeof i.value === "number") expect(Number.isFinite(i.value)).toBe(true);
      if (i.confidence !== null) expect(Number.isFinite(i.confidence)).toBe(true);
    }
  }, 60_000);

  /** A spoofed period must not silently become a different window. */
  test("an unrecognised period is refused, not coerced", async () => {
    for (const bad of ["hourly", "'; DROP TABLE bookings; --", "DAILY", "1"]) {
      const r = await get(`${BRIEF}?period=${encodeURIComponent(bad)}`, bearer(ctx.superAdmin));
      // Elysia's schema validation rejects with 400. What matters is that it rejects rather than
      // falling back to a default window — a spoofed period must never silently change the report.
      expect(r.status).toBe(400);
      expect(r.body?.data).toBeUndefined();
    }
  }, 60_000);

  test("a valid period is honoured and reported back", async () => {
    const r = await get(`${BRIEF}?period=weekly`, bearer(ctx.superAdmin));
    expect(r.status).toBe(200);
    expect((r.body!.data as { period: string }).period).toBe("weekly");
  }, 60_000);
});

describe("the schedule endpoint tells the truth about being unconfigured", () => {
  test("it reports UNSET, an off flag, and three outstanding decisions", async () => {
    const r = await get(SCHEDULE, bearer(ctx.superAdmin));
    expect(r.status).toBe(200);
    const d = r.body!.data as {
      capabilityState: string;
      schedule: { status: string; approved: boolean; localTime: null; recurrence: null; timezoneStrategy: null };
      featureFlag: { enabled: boolean };
      deliveryMode: string; lastRun: null; nextRun: null;
      humanDecisions: string[]; recipientCount: number;
    };
    expect(d.capabilityState).toBe("DISABLED_UNTIL_SCHEDULE_APPROVED");
    expect(d.schedule.status).toBe("UNSET");
    expect(d.schedule.approved).toBe(false);
    // All three nulls are exposed separately — a UI cannot show half the truth.
    expect(d.schedule.localTime).toBeNull();
    expect(d.schedule.recurrence).toBeNull();
    expect(d.schedule.timezoneStrategy).toBeNull();
    expect(d.featureFlag.enabled).toBe(false);
    expect(d.deliveryMode).toBe("SHADOW");
    expect(d.lastRun).toBeNull();
    expect(d.nextRun).toBeNull();
    expect(d.humanDecisions.length).toBe(3);
  });

  /** No default hour, recurrence or zone may leak out of the endpoint. */
  test("no business default is invented in the response", async () => {
    const r = await get(SCHEDULE, bearer(ctx.superAdmin));
    const raw = JSON.stringify(r.body);
    for (const forbidden of ["08:00", "09:00", "\"daily\"", "\"weekly\"", "Asia/Kolkata"]) {
      expect(raw.includes(forbidden)).toBe(false);
    }
  });

  test("recipients carry a role and a basis, never a contact detail", async () => {
    const r = await get(RECIPIENTS, bearer(ctx.superAdmin));
    expect(r.status).toBe(200);
    const rows = r.body!.data as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["adminId", "basis", "roleName", "userId"]);
    }
    // Identifiers must be identifiers, and the only free text (role, basis) must carry no contact
    // detail. Scanning the whole payload for ten digits misfired on ids: a cuid such as
    // "cmu8342610216tz…" legitimately contains a ten-digit run, and failed this test for nothing.
    for (const row of rows) {
      expect(String(row.adminId)).toMatch(/^[a-z0-9_-]+$/i);
      expect(String(row.userId)).toMatch(/^[a-z0-9_-]+$/i);
      const text = `${row.roleName ?? ""} ${row.basis ?? ""}`;
      expect(text.includes("@")).toBe(false);
      expect(/\+?\d{10}/.test(text)).toBe(false);
    }
    expect(JSON.stringify(rows).includes("@")).toBe(false);
  });
});

describe("reading intelligence mutates nothing", () => {
  test("opening every intelligence endpoint leaves business state unchanged", async () => {
    const token = bearer(ctx.superAdmin);
    await get(BRIEF, token);
    await get(`${BRIEF}?period=weekly`, token);
    await get(SCHEDULE, token);
    await get(RECIPIENTS, token);
    expect(await snapshot()).toEqual(baseline);
  }, 120_000);

  test("no feature flag was created by reading the schedule", async () => {
    const row = await prisma.platformFeatureFlag.findFirst({
      where: { key: "ADMIN_EXECUTIVE_SCHEDULED_REPORTS" },
    });
    expect(row).toBeNull();
  });

  test("no ScheduledJob of the report type was created", async () => {
    expect(await prisma.scheduledJob.count({ where: { jobType: "report.executive_brief" } })).toBe(0);
  });
});
