/**
 * Owner decision 2026-09-29: a service with no approved execution / safety / quality METHOD facts is not
 * offered — it is PAUSED through the canonical lifecycle write (never deleted, slug and configuration
 * kept), with the internal reason recorded for operations. Covers the two services without a draft
 * (spa, personal-hygiene-bathing-care) and the six held services (WORK steps withheld).
 *
 * Through the real CLI and routes on the isolated test DB, with test-only `--map slug=serviceId`.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSyncFreshClock } from "./helpers/fresh-loop-clock";
import { join } from "node:path";
import prisma from "../lib/prisma";
import app from "../index";
import { PAUSE_REASON } from "../../scripts/phase10-pause-unsupported-services";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const RUN = `p10pause-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let secondServiceId = "";

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const admin = () => bearer(ctx.superAdmin);
const BASE = {
  materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [] as unknown[], requirements: [] as unknown[],
};
// Clock-safe timed spawn (helpers/fresh-loop-clock): a stale loop clock expired this timeout at once.
async function pause(extra: string[]) {
  const r = await spawnSyncFreshClock(process.execPath, ["run", "scripts/phase10-pause-unsupported-services.ts", "--url", process.env.DATABASE_URL!, ...extra], {
    cwd: join(import.meta.dir, "..", ".."), encoding: "utf8", timeout: 60_000, env: { ...process.env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const svc = (id: string) => prisma.service.findUniqueOrThrow({ where: { id }, select: { lifecycleStatus: true, isActive: true, isBookable: true, isCustomerVisible: true, operationsNotes: true, slug: true, catalogConfig: true, version: true } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const put = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: BASE, changeReason: "pause test base" }, admin());
  if (put.status !== 200) throw new Error(`base: ${JSON.stringify(put.json)}`);
  const second = await prisma.service.create({
    data: { ...LIVE_FIXTURE_SERVICE, name: `Adv Second ${RUN}`, slug: `adv-second-${RUN}`, description: "fixture", category: "cleaning", basePrice: 250, estimatedDuration: 60, isActive: true, dataOrigin: "INFERRED_TEST" },
  });
  secondServiceId = second.id;
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.service.deleteMany({ where: { id: secondServiceId } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("pause services that have no approved method facts", () => {
  test("a service whose approved content is complete is never paused by this tool", async () => {
    if (!dbOk) return;
    const r = await pause(["--services", "deep-cleaning", "--map", `deep-cleaning=${secondServiceId}`]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("deep-cleaning");
    expect(r.out).toMatch(/complete approved content/i);
  }, 90_000);

  test("report mode names each candidate, its reason and its open bookings, and writes nothing", async () => {
    if (!dbOk) return;
    const before = await svc(ctx.serviceId);
    const r = await pause(["--services", "plumbing", "--map", `plumbing=${ctx.serviceId}`]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("plumbing: WOULD_PAUSE");
    expect(r.out).toContain("OWNER_APPROVAL_REQUIRED");
    expect(await svc(ctx.serviceId)).toEqual(before);
  }, 90_000);

  test("--apply pauses through the lifecycle write, keeps slug and configuration, records the reason for operations", async () => {
    if (!dbOk) return;
    const before = await svc(ctx.serviceId);
    const r = await pause(["--services", "plumbing", "--map", `plumbing=${ctx.serviceId}`, "--apply", "--actor-id", ctx.superAdmin.id]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("plumbing: PAUSED");
    const after = await svc(ctx.serviceId);
    expect(after).toMatchObject({ lifecycleStatus: "PAUSED", isActive: false, isBookable: false, isCustomerVisible: false, slug: before.slug });
    expect(after.catalogConfig).toEqual(before.catalogConfig);
    expect(after.operationsNotes).toContain(PAUSE_REASON);
    const audit = await prisma.activityLog.findMany({ where: { action: "ADMIN_ACTION", description: { contains: ctx.serviceId } }, select: { description: true } });
    expect(audit.some((a) => a.description?.includes("SERVICE_PAUSED_PENDING_METHOD_FACTS") && a.description.includes(PAUSE_REASON))).toBe(true);
    expect(audit.some((a) => a.description?.includes("SERVICE_LIFECYCLE_CHANGED") && a.description.includes('"to":"PAUSED"'))).toBe(true);
  }, 90_000);

  test("a paused service cannot be booked, is hidden from customers, and admin shows it paused with the reason", async () => {
    if (!dbOk) return;
    const b = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(190).toISOString() }, bearer(ctx.customerA));
    expect(b.status).toBeGreaterThanOrEqual(400);
    expect(b.json.code).toMatch(/^(SERVICE_UNAVAILABLE|SERVICE_NOT_BOOKABLE)$/);
    const list = await call("GET", "/api/services?limit=100");
    expect(JSON.stringify(list.json)).not.toContain(ctx.serviceId);
    const a = await call("GET", `/api/admin/services/${ctx.serviceId}`, undefined, admin());
    expect(a.status).toBe(200);
    expect(JSON.stringify(a.json)).toContain("PAUSED");
    expect(JSON.stringify(a.json)).toContain(PAUSE_REASON);
  }, 90_000);

  test("a second --apply is a no-op", async () => {
    if (!dbOk) return;
    const before = await svc(ctx.serviceId);
    const r = await pause(["--services", "plumbing", "--map", `plumbing=${ctx.serviceId}`, "--apply", "--actor-id", ctx.superAdmin.id]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("plumbing: SKIP_ALREADY_PAUSED");
    expect(await svc(ctx.serviceId)).toEqual(before);
  }, 90_000);

  test("--map is refused outside a test database and --apply needs a SUPER_ADMIN actor", async () => {
    if (!dbOk) return;
    const r = await pause(["--services", "spa", "--map", `spa=${secondServiceId}`, "--apply", "--actor-id", ctx.customerA.id]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("not an active SUPER_ADMIN");
  }, 90_000);
});
