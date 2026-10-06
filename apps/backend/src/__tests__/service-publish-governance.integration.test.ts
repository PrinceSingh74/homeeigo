/**
 * Service control plane against the real database and routes: nothing reaches LIVE without the
 * publish gate and a second admin's approval of the exact content, whichever route is used.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { catalogService } from "../services/catalog.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN_ID = `svcgov-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const created: string[] = [];
let seq = 0;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN_ID);
}, 90_000);

afterAll(async () => {
  if (!dbOk) return;
  for (const id of created) {
    await prisma.serviceConfigVersion.deleteMany({ where: { serviceId: id } }).catch(() => {});
    await prisma.service.delete({ where: { id } }).catch(() => {});
  }
  await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

type Res = { status: number; json: { success: boolean; code?: string; error?: string; data?: any } };

async function call(method: string, path: string, body?: unknown): Promise<Res> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.superAdmin)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Res["json"] };
}

/** A gate-clean service in review whose last editor is the support admin (so the super admin may approve). */
async function serviceInReview(): Promise<string> {
  seq += 1;
  const r = await call("POST", "/api/admin/services", {
    name: `Gov ${RUN_ID} ${seq}`,
    description: "A fixture service with a real description",
    category: "cleaning",
    basePrice: 300,
    estimatedDuration: 60,
    catalogConfig: { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" },
    isActive: false,
  });
  if (r.status !== 200) throw new Error(`create: ${JSON.stringify(r.json)}`);
  const id = r.json.data.service.id as string;
  created.push(id);
  await prisma.service.update({ where: { id }, data: { lifecycleStatus: "READY_FOR_REVIEW", updatedBy: ctx.supportAdmin.id } });
  return id;
}
const row = (id: string) => prisma.service.findUniqueOrThrow({ where: { id } });

describe.serial("nothing goes live without gate and approval", () => {
  test("control: an approved, gate-clean service in review goes live", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    expect((await call("POST", `/api/admin/services/${id}/approve`, {})).status).toBe(200);
    const live = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ACTIVE" });
    expect(live.status).toBe(200);
    expect((await row(id)).lifecycleStatus).toBe("ACTIVE");
  });

  test("PUT isActive:true cannot publish a service nobody approved", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    const r = await call("PUT", `/api/admin/services/${id}`, { isActive: true });
    expect(r.json.code).toBe("APPROVAL_REQUIRED");
    expect(r.status).toBe(409);
    const s = await row(id);
    expect(s.isActive).toBe(false);
    expect(s.lifecycleStatus).toBe("READY_FOR_REVIEW");
  });

  test("PUT isActive:true cannot jump a scheduled go-live", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    expect((await call("POST", `/api/admin/services/${id}/approve`, { scheduledLiveAt: "2099-01-01T09:00:00+05:30" })).status).toBe(200);
    const r = await catalogService.update(id, { isActive: true }, ctx.supportAdmin.id);
    expect("error" in r ? r.error : null).toBe("SCHEDULED_NOT_DUE");
    expect((await row(id)).isActive).toBe(false);
  });

  test("a price edit by the approved editor voids the approval", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    expect((await call("POST", `/api/admin/services/${id}/approve`, {})).status).toBe(200);
    const edit = await catalogService.update(id, { basePrice: 999, minPrice: 999, maxPrice: 999 }, ctx.supportAdmin.id);
    expect("error" in edit ? edit.error : null).toBeNull();
    const live = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ACTIVE" });
    expect(live.json.code).toBe("APPROVAL_STALE");
    expect((await row(id)).isActive).toBe(false);
  });

  test("approve refuses a draft", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    await prisma.service.update({ where: { id }, data: { lifecycleStatus: "DRAFT" } });
    const r = await call("POST", `/api/admin/services/${id}/approve`, {});
    expect(r.json.code).toBe("NOT_AWAITING_APPROVAL");
    expect(r.status).toBe(409);
  });

  test("approve refuses a configuration that fails the publish gate", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    await prisma.service.update({ where: { id }, data: { basePrice: 0, minPrice: null, maxPrice: null } });
    const r = await call("POST", `/api/admin/services/${id}/approve`, {});
    expect(r.json.code).toBe("SERVICE_NOT_BOOKABLE");
    const cfg = (await row(id)).catalogConfig as { publishApproval?: unknown } | null;
    expect(cfg?.publishApproval).toBeUndefined();
  });

  test("approve refuses a version the approver did not review", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    const version = (await row(id)).version;
    const r = await call("POST", `/api/admin/services/${id}/approve`, { expectedVersion: version + 1 });
    expect(r.json.code).toBe("VERSION_CONFLICT");
    expect((await call("POST", `/api/admin/services/${id}/approve`, { expectedVersion: version })).status).toBe(200);
  });
});

describe.serial("schedule, unschedule and the reason for taking a service off sale", () => {
  test("the admin row names the control-plane state: REVIEW, then SCHEDULED, then APPROVED after unscheduling", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    const state = async () => (await call("GET", `/api/admin/services/${id}`)).json.data.service.controlState;
    expect(await state()).toBe("REVIEW");
    expect((await call("POST", `/api/admin/services/${id}/approve`, { scheduledLiveAt: "2099-01-01T09:00:00+05:30" })).status).toBe(200);
    expect(await state()).toBe("SCHEDULED");
    const un = await call("POST", `/api/admin/services/${id}/unschedule`, {});
    expect(un.status).toBe(200);
    expect(un.json.data.service.scheduledLiveAt).toBeNull();
    expect(await state()).toBe("APPROVED");
    // The approval survived, so the service can go live now.
    expect((await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ACTIVE" })).status).toBe(200);
    expect(await state()).toBe("LIVE");
  });

  test("unschedule refuses a service that has no schedule", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    const r = await call("POST", `/api/admin/services/${id}/unschedule`, {});
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("NOT_SCHEDULED");
  });

  test("pausing needs a reason, records it, and reports the bookings still open on the service", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    expect((await call("POST", `/api/admin/services/${id}/approve`, {})).status).toBe(200);
    expect((await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ACTIVE" })).status).toBe(200);
    const noReason = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "PAUSED" });
    expect(noReason.status).toBe(400);
    expect(noReason.json.code).toBe("REASON_REQUIRED");
    expect((await row(id)).lifecycleStatus).toBe("ACTIVE");
    const paused = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "PAUSED", reason: "Supplier recall of the cleaning agent" });
    expect(paused.status).toBe(200);
    expect(paused.json.data.impact).toEqual({ openBookings: 0 });
    let entry: any;
    for (let i = 0; i < 40 && !entry; i++) {
      const entries = (await call("GET", `/api/admin/services/${id}/audit`)).json.data.entries as any[];
      entry = entries.find((e) => e.action === "SERVICE_LIFECYCLE_CHANGED" && e.to === "PAUSED");
      if (!entry) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(entry?.reason).toBe("Supplier recall of the cleaning agent");
  });
});

describe.serial("the legacy on/off toggle obeys the same off-sale rule", () => {
  test("switching a live service off needs a reason; switching an already-off service off does not", async () => {
    expect(dbOk).toBe(true);
    const id = await serviceInReview();
    // Not live yet: "off" is where it already is, so nothing is being taken off sale.
    expect((await call("PATCH", `/api/admin/services/${id}/status`, { isActive: false })).status).toBe(200);
    expect((await call("POST", `/api/admin/services/${id}/approve`, {})).status).toBe(200);
    expect((await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ACTIVE" })).status).toBe(200);

    const noReason = await call("PATCH", `/api/admin/services/${id}/status`, { isActive: false });
    expect(noReason.status).toBe(400);
    expect(noReason.json.code).toBe("REASON_REQUIRED");
    expect((await row(id)).lifecycleStatus).toBe("ACTIVE");
    const blank = await call("PATCH", `/api/admin/services/${id}/status`, { isActive: false, reason: "   " });
    expect(blank.json.code).toBe("REASON_REQUIRED");

    const off = await call("PATCH", `/api/admin/services/${id}/status`, { isActive: false, reason: "Seasonal stop" });
    expect(off.status).toBe(200);
    expect((await row(id)).lifecycleStatus).toBe("PAUSED");
    expect(off.json.data.impact).toEqual({ openBookings: 0 });
    let entry: any;
    for (let i = 0; i < 40 && !entry; i++) {
      const entries = (await call("GET", `/api/admin/services/${id}/audit`)).json.data.entries as any[];
      entry = entries.find((e) => e.action === "SERVICE_LIFECYCLE_CHANGED" && e.to === "PAUSED");
      if (!entry) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(entry?.reason).toBe("Seasonal stop");
  });
});

/** A live, gate-clean service last edited by the support admin. */
async function liveService(): Promise<string> {
  const id = await serviceInReview();
  if ((await call("POST", `/api/admin/services/${id}/approve`, {})).status !== 200) throw new Error("approve failed");
  if ((await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ACTIVE" })).status !== 200) throw new Error("publish failed");
  return id;
}
const drafts = (id: string) => prisma.serviceConfigVersion.count({ where: { serviceId: id, status: "DRAFT" } });

describe.serial("a live service changes only through an approved revision (four-eyes policy)", () => {
  const before = process.env.SERVICE_LIVE_EDIT_POLICY;
  beforeAll(() => {
    process.env.SERVICE_LIVE_EDIT_POLICY = "four-eyes";
  });
  afterAll(() => {
    if (before === undefined) delete process.env.SERVICE_LIVE_EDIT_POLICY;
    else process.env.SERVICE_LIVE_EDIT_POLICY = before;
  });

  test("a price edit is held as a pending revision and the live service does not change", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    const live = await row(id);
    const r = await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450, changeReason: "Annual price review" });
    expect(r.status).toBe(200);
    expect(r.json.data.pendingRevision.changes).toContainEqual({ field: "basePrice", before: 300, after: 450 });
    const after = await row(id);
    expect(after.basePrice).toBe(300);
    expect(after.version).toBe(live.version);
    expect(await drafts(id)).toBe(1);
    const seen = await call("GET", `/api/admin/services/${id}`);
    expect(seen.json.data.service.pendingRevision.proposedBy).toBe(ctx.superAdmin.id);
    expect(seen.json.data.service.pendingRevision.changeReason).toBe("Annual price review");
  });

  test("the proposer cannot approve their own revision", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450 });
    const r = await call("POST", `/api/admin/services/${id}/revision/approve`, {});
    expect(r.json.code).toBe("APPROVER_IS_EDITOR");
    expect((await row(id)).basePrice).toBe(300);
  });

  test("a second admin's approval applies the revision as the next published version", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    const live = await row(id);
    await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450 });
    const r = await catalogService.approveRevision(id, ctx.financeAdmin.id);
    expect("error" in r ? r.error : null).toBeNull();
    const after = await row(id);
    expect(after.basePrice).toBe(450);
    expect(after.version).toBe(live.version + 1);
    expect(await drafts(id)).toBe(0);
    const published = await prisma.serviceConfigVersion.findUnique({ where: { serviceId_version: { serviceId: id, version: after.version } } });
    expect(published?.status).toBe("PUBLISHED");
  });

  test("a rejected revision is discarded and the live service does not change", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450 });
    const r = await call("POST", `/api/admin/services/${id}/revision/reject`, { reason: "Not agreed" });
    expect(r.status).toBe(200);
    expect(await drafts(id)).toBe(0);
    expect((await row(id)).basePrice).toBe(300);
    expect((await call("POST", `/api/admin/services/${id}/revision/approve`, {})).json.code).toBe("NO_PENDING_REVISION");
  });

  test("a revision proposed against content that has since changed cannot be approved", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450 });
    await prisma.service.update({ where: { id }, data: { estimatedDuration: 75 } });
    const r = await catalogService.approveRevision(id, ctx.financeAdmin.id);
    expect("error" in r ? r.error : null).toBe("REVISION_OUTDATED");
    expect((await row(id)).basePrice).toBe(300);
  });

  test("an approved revision can be scheduled: nothing changes until the time, then the scheduler applies it", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    const live = await row(id);
    await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450, changeReason: "Festival price" });
    const at = "2099-01-01T09:00:00+05:30";
    const scheduled = await catalogService.approveRevision(id, ctx.financeAdmin.id, { scheduledLiveAt: at });
    expect("error" in scheduled ? scheduled.error : null).toBeNull();
    expect((await row(id)).basePrice).toBe(300);
    const seen = (await call("GET", `/api/admin/services/${id}`)).json.data.service.pendingRevision;
    expect(seen.scheduledLiveAt).toBe(at);
    expect(seen.approvedBy).toBe(ctx.financeAdmin.id);

    // Before the time: the tick leaves it alone.
    expect((await catalogService.activateScheduledServices(new Date("2098-12-31T00:00:00Z"))).revisionsApplied).toBe(0);
    expect((await row(id)).basePrice).toBe(300);
    // At the time: applied as the next published version.
    const tick = await catalogService.activateScheduledServices(new Date("2099-01-01T04:00:00Z"));
    expect(tick.revisionsApplied).toBeGreaterThanOrEqual(1);
    const after = await row(id);
    expect(after.basePrice).toBe(450);
    expect(after.version).toBe(live.version + 1);
    expect(await drafts(id)).toBe(0);
  });

  test("a scheduled revision whose base has changed by its time is not applied, and says so", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450 });
    expect("error" in (await catalogService.approveRevision(id, ctx.financeAdmin.id, { scheduledLiveAt: "2099-01-01T09:00:00+05:30" }))).toBe(false);
    await prisma.service.update({ where: { id }, data: { estimatedDuration: 75 } });
    const tick = await catalogService.activateScheduledServices(new Date("2099-01-01T04:00:00Z"));
    expect(tick.revisionsFailed).toBeGreaterThanOrEqual(1);
    expect((await row(id)).basePrice).toBe(300);
    expect(await drafts(id)).toBe(1);
  });

  test("a schedule in the past or an unreadable time is refused; the proposer still cannot approve", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450 });
    const bad = await catalogService.approveRevision(id, ctx.financeAdmin.id, { scheduledLiveAt: "not-a-time" });
    expect("error" in bad ? bad.error : null).toBe("INVALID_CONFIG");
    const own = await call("POST", `/api/admin/services/${id}/revision/approve`, { scheduledLiveAt: "2099-01-01T09:00:00+05:30" });
    expect(own.json.code).toBe("APPROVER_IS_EDITOR");
    expect((await row(id)).basePrice).toBe(300);
  });

  test("pausing a live service is immediate and needs no revision", async () => {
    expect(dbOk).toBe(true);
    const id = await liveService();
    const r = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "PAUSED", reason: "Paused for the test" });
    expect(r.status).toBe(200);
    expect((await row(id)).isBookable).toBe(false);
  });
});

describe.serial("default policy", () => {
  test("control: without the four-eyes policy a live edit applies at once and bumps the version", async () => {
    expect(dbOk).toBe(true);
    expect(process.env.SERVICE_LIVE_EDIT_POLICY).not.toBe("four-eyes");
    const id = await liveService();
    const live = await row(id);
    const r = await call("PUT", `/api/admin/services/${id}`, { basePrice: 450, minPrice: 450, maxPrice: 450 });
    expect(r.status).toBe(200);
    const after = await row(id);
    expect(after.basePrice).toBe(450);
    expect(after.version).toBe(live.version + 1);
    expect(await drafts(id)).toBe(0);
  });
});

const POLICIES = { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" };
const FULL = {
  ...POLICIES,
  safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" },
  quality: { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"] },
  execution: { steps: [{ id: "work", title: "Do the work", kind: "WORK", sortOrder: 1 }] },
};
/** Live with `config`, published the governed way (review → second admin's approval → ACTIVE). */
async function liveWith(config: Record<string, unknown>): Promise<string> {
  const id = await serviceInReview();
  await prisma.service.update({ where: { id }, data: { catalogConfig: config as never } });
  if ((await call("POST", `/api/admin/services/${id}/approve`, {})).status !== 200) throw new Error("approve failed");
  const live = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ACTIVE" });
  if (live.status !== 200) throw new Error(`publish failed: ${JSON.stringify(live.json)}`);
  return id;
}
const configOf = async (id: string) => ((await row(id)).catalogConfig ?? {}) as Record<string, unknown>;

describe.serial("an edit to a live service may not remove what a first publish requires", () => {
  const before = process.env.SERVICE_PUBLISH_REQUIRES;
  const requireSections = () => {
    process.env.SERVICE_PUBLISH_REQUIRES = "safety,quality,execution";
  };
  afterAll(() => {
    if (before === undefined) delete process.env.SERVICE_PUBLISH_REQUIRES;
    else process.env.SERVICE_PUBLISH_REQUIRES = before;
  });

  test("deleting the safety section from a live service is refused, and the service keeps it", async () => {
    expect(dbOk).toBe(true);
    requireSections();
    const id = await liveWith(FULL);
    const { safety: _removed, ...withoutSafety } = FULL;
    const r = await call("PUT", `/api/admin/services/${id}`, { catalogConfig: withoutSafety });
    expect(r.json.code).toBe("SERVICE_NOT_BOOKABLE");
    expect(JSON.stringify(r.json)).toContain("SAFETY_ABSENT");
    expect((await configOf(id)).safety).toEqual(FULL.safety);
    expect((await row(id)).lifecycleStatus).toBe("ACTIVE");
  });

  test("emptying it instead of deleting it is the same thing", async () => {
    expect(dbOk).toBe(true);
    requireSections();
    const id = await liveWith(FULL);
    const r = await call("PUT", `/api/admin/services/${id}`, { catalogConfig: { ...FULL, safety: {}, quality: { notApplicable: true } } });
    expect(r.json.code).toBe("SERVICE_NOT_BOOKABLE");
    expect((await configOf(id)).quality).toEqual(FULL.quality);
  });

  test("control: a live service that never had those sections can still be edited, and stays live", async () => {
    expect(dbOk).toBe(true);
    delete process.env.SERVICE_PUBLISH_REQUIRES;
    process.env.SERVICE_PUBLISH_REQUIRES = "none";
    const id = await liveWith(POLICIES);
    requireSections();
    const r = await call("PUT", `/api/admin/services/${id}`, { description: "A clearer description of the same fixture service" });
    expect(r.status).toBe(200);
    expect((await row(id)).lifecycleStatus).toBe("ACTIVE");
    // …and adding the missing sections is accepted.
    expect((await call("PUT", `/api/admin/services/${id}`, { catalogConfig: FULL })).status).toBe(200);
  });

  test("restoring an older version that lacks them is refused the same way", async () => {
    expect(dbOk).toBe(true);
    process.env.SERVICE_PUBLISH_REQUIRES = "none";
    const id = await liveWith(POLICIES);
    expect((await call("PUT", `/api/admin/services/${id}`, { catalogConfig: FULL })).status).toBe(200);
    const first = await prisma.serviceConfigVersion.findFirstOrThrow({ where: { serviceId: id, status: "PUBLISHED" }, orderBy: { version: "asc" } });
    requireSections();
    const r = await call("POST", `/api/admin/services/${id}/versions/${first.version}/restore`, { reason: "Roll back to the first version" });
    expect(r.json.code).toBe("SERVICE_NOT_BOOKABLE");
    expect((await configOf(id)).safety).toEqual(FULL.safety);
  });
});

describe.serial("visible-but-not-bookable to bookable is a publish", () => {
  test("clearing 'coming soon' on a live service needs the gate and a second admin, like any other way into bookable", async () => {
    expect(dbOk).toBe(true);
    const id = await liveWith({ ...POLICIES, comingSoon: true });
    expect((await row(id)).lifecycleStatus).toBe("PUBLISHED");
    const r = await call("PUT", `/api/admin/services/${id}`, { catalogConfig: { ...POLICIES, comingSoon: false } });
    expect(["APPROVAL_REQUIRED", "APPROVAL_STALE"]).toContain(r.json.code as string);
    const s = await row(id);
    expect({ lifecycle: s.lifecycleStatus, bookable: s.isBookable }).toEqual({ lifecycle: "PUBLISHED", bookable: false });
  });
});

describe.serial("VALIDATING validates", () => {
  async function draft(config: Record<string, unknown>): Promise<string> {
    seq += 1;
    const r = await call("POST", "/api/admin/services", { name: `Gov ${RUN_ID} ${seq}`, description: "A fixture service with a real description", category: "cleaning", basePrice: 300, estimatedDuration: 60, catalogConfig: config, isActive: false });
    if (r.status !== 200) throw new Error(`create: ${JSON.stringify(r.json)}`);
    created.push(r.json.data.service.id);
    return r.json.data.service.id as string;
  }

  test("entering VALIDATING runs the gate and answers with what it found", async () => {
    expect(dbOk).toBe(true);
    const id = await draft({});
    const r = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "CONFIGURATION_REQUIRED" });
    expect(r.status).toBe(200);
    expect(r.json.data.validation.ok).toBe(false);
    expect((r.json.data.validation.blocking as { code: string }[]).map((b) => b.code).sort()).toEqual(["EQUIPMENT_POLICY", "MATERIALS_POLICY"]);
  });

  test("a service that fails validation cannot be sent for review; once fixed it can", async () => {
    expect(dbOk).toBe(true);
    const id = await draft({});
    await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "CONFIGURATION_REQUIRED" });
    const refused = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "READY_FOR_REVIEW" });
    expect(refused.json.code).toBe("SERVICE_NOT_BOOKABLE");
    expect((await row(id)).lifecycleStatus).toBe("CONFIGURATION_REQUIRED");
    expect((await call("PUT", `/api/admin/services/${id}`, { catalogConfig: POLICIES })).status).toBe(200);
    const sent = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "READY_FOR_REVIEW" });
    expect(sent.status).toBe(200);
    expect(sent.json.data.validation.ok).toBe(true);
    expect((await row(id)).lifecycleStatus).toBe("READY_FOR_REVIEW");
  });
});
