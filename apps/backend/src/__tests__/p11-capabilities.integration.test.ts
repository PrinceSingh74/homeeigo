/**
 * Phase 11 — provider capability write / admin APIs end to end on the isolated test DB, through the
 * real routes (`/api/providers/me/capabilities/*`, `/api/admin/...`).
 *
 * What is proven here (and nowhere else):
 *   - a partner only ever DECLARES: status DECLARED, source SELF, data_origin = the provider user's
 *     origin — whatever the request body claims;
 *   - a VERIFIED row's facts are locked for the partner (409 CAPABILITY_LOCKED);
 *   - every admin transition lands in provider_capability_audit with the admin's user id + reason;
 *   - the database CHECKs are the second line (VERIFIED without a verifier is impossible);
 *   - a service capability can only be requested for an operational service, a business service
 *     only with an admin-recorded membership, and Q16: no partner call activates a capability;
 *   - other partners see nothing and change nothing (404); admin document verify is bound to the
 *     provider in the path; a partner cannot rewrite a verified document's expiry.
 *
 * Every service created here gets its own category: the legacy rule (`providerOffersService`,
 * rule 4) treats a signup service id as covering every service of the same category, so the
 * grandfathering step would otherwise fan out across the whole test catalogue.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bearer, cleanupAdversarialFixtures, dbReachable, deleteBookingsForUsers, fixturePhone, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const RUN = `p11it${Date.now().toString(36)}`; // lowercase alnum: also a valid capability code prefix
const TAG = `adv-${RUN}`;
let ctx: AdvCtx;
let dbOk = false;
let deployed = false;

/** Second partner (no capability at all) — must never see or touch the first partner's rows. */
let other: { userId: string; email: string; providerId: string };
let signupServiceId = ""; // the fixture partner's signup service (legacy String[])
let plainServiceId = ""; // requestable, nobody's business
let draftServiceId = ""; // lifecycle DRAFT: not partner-operational
let bizServiceId = ""; // owned by a business
let businessId = "";
let verifiedDocId = ""; // a verified document of the fixture partner
let otherDocId = ""; // a document of the OTHER partner
const skillCode = `${RUN}-wiring`;
const skillCode2 = `${RUN}-plumbing`;

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const admin = () => bearer(ctx.superAdmin);
const partner = () => bearer({ id: ctx.vendorUserId, email: `${TAG}-vendor@adv.test` });
const otherPartner = () => bearer({ id: other.userId, email: other.email });
const ME = "/api/providers/me/capabilities";
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

/** The fixture partner's user e-mail is on a reserved domain, so every row must carry this origin. */
const EXPECTED_ORIGIN = "INFERRED_SYNTHETIC";

/** Services an admin has activated for the fixture partner (the only legitimate non-LEGACY ACTIVE rows). */
const adminActivated = new Set<string>();

/**
 * Q16 — run after EVERY partner call. An ACTIVE row for the partner is either the grandfathered
 * copy of the signup service (source LEGACY, written so current jobs keep matching) or one an
 * admin activated (verified_by = the admin). A partner's own request (source SELF) is never ACTIVE
 * unless an admin approved it.
 */
async function assertNoPartnerActivation(providerId = ctx.providerId): Promise<void> {
  const rows = await prisma.$queryRaw<{ service_id: string; source: string; verified_by: string | null; status: string }[]>`
    SELECT service_id, source, verified_by, status FROM provider_service_capabilities WHERE provider_id = ${providerId} AND status = 'ACTIVE'`;
  for (const r of rows) {
    if (r.source === "LEGACY") {
      expect(r.service_id).toBe(signupServiceId);
      continue;
    }
    expect(adminActivated.has(r.service_id)).toBe(true);
    expect(r.verified_by).toBe(ctx.superAdmin.id);
  }
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM provider_service_capabilities WHERE provider_id = ${providerId} AND source = 'SELF' AND status = 'ACTIVE' AND verified_by IS DISTINCT FROM ${ctx.superAdmin.id}`;
  expect(Number(n)).toBe(0);
}

/** Partner call + the Q16 assertion in one step. */
async function partnerCall(method: string, path: string, body?: unknown, token = partner()): Promise<Res> {
  const r = await call(method, path, body, token);
  await assertNoPartnerActivation();
  return r;
}

/** bun's `expect(...).rejects` wants a native Promise; a PrismaPromise is not one. */
const sqlFails = (p: PromiseLike<unknown>) => expect((async () => { await p; })()).rejects;

async function lastAudit(table: string, rowId: number | string) {
  const rows = await prisma.$queryRaw<{ action: string; actor_type: string | null; actor_id: string | null; reason: string | null }[]>`
    SELECT action, actor_type, actor_id, reason FROM provider_capability_audit WHERE table_name = ${table} AND row_id = ${String(rowId)} ORDER BY id DESC LIMIT 1`;
  return rows[0] ?? null;
}

async function createService(suffix: string, extra: Record<string, unknown> = {}) {
  const s = await prisma.service.create({
    data: { ...LIVE_FIXTURE_SERVICE,
      name: `Adv ${suffix} ${TAG}`,
      slug: `${TAG}-${suffix}`,
      description: "Phase 11 capability integration fixture",
      category: `p11${suffix}-${RUN}`,
      basePrice: 500,
      estimatedDuration: 60,
      availableCities: ["Noida"],
      tags: ["adv"],
      ...extra,
    } as never,
    select: { id: true },
  });
  return s.id;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`SELECT (to_regclass('provider_service_capabilities') IS NOT NULL AND to_regclass('provider_capability_audit') IS NOT NULL) AS present`;
  deployed = present === true;
  if (!deployed) throw new Error("Phase 11 migration 20260924223000_provider_capabilities is not on the test database — run bun run test:setup");
  ctx = await seedAdversarialFixtures(RUN);

  signupServiceId = await createService("signup");
  plainServiceId = await createService("plain");
  draftServiceId = await createService("draft", { lifecycleStatus: "DRAFT" });
  bizServiceId = await createService("biz");
  // The signup list names ONE service in its own category, so grandfathering is exactly one row.
  await prisma.provider.update({ where: { id: ctx.providerId }, data: { serviceCategories: [signupServiceId] } });

  const otherEmail = `${TAG}-other@adv.test`;
  const otherUser = await prisma.user.create({
    data: {
      email: otherEmail, phoneNumber: fixturePhone(RUN, "other"), firstName: "Adv", lastName: "Other",
      password: await Bun.password.hash("AdvTest@123", { algorithm: "bcrypt", cost: 4 }), role: "VENDOR", isEmailVerified: true, isPhoneVerified: true,
    },
    select: { id: true },
  });
  const otherProvider = await prisma.provider.create({ data: { userId: otherUser.id, serviceCategories: [], isVerified: true, isApproved: true, isActive: true }, select: { id: true } });
  other = { userId: otherUser.id, email: otherEmail, providerId: otherProvider.id };

  const doc = await prisma.providerDocument.create({
    data: { providerId: ctx.providerId, documentType: "insurance", documentUrl: `/uploads/${TAG}-verified.pdf`, documentName: "policy.pdf", isVerified: true, verifiedAt: new Date(), expiryDate: new Date(Date.now() + 200 * day) },
    select: { id: true },
  });
  verifiedDocId = doc.id;
  const odoc = await prisma.providerDocument.create({
    data: { providerId: other.providerId, documentType: "certificate", documentUrl: `/uploads/${TAG}-other.pdf`, documentName: "cert.pdf" },
    select: { id: true },
  });
  otherDocId = odoc.id;
}, 120_000);

afterAll(async () => {
  if (!dbOk || !ctx) return;
  // cleanupAdversarialFixtures looks users up by `email: { contains: tag }`, but the PII extension
  // stores e-mail encrypted (users.email is NULL, lookups go through email_hash), so that helper
  // finds nobody and returns before deleting anything. This suite purges by the ids it holds.
  await cleanupAdversarialFixtures(RUN);
  const userIds = [ctx.customerA.id, ctx.customerB.id, ctx.vendorUserId, ctx.legacyAdmin.id, ctx.supportAdmin.id, ctx.financeAdmin.id, ctx.superAdmin.id, other?.userId].filter((x): x is string => !!x);
  const failures: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (err) { failures.push(`${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`); } };
  // Providers cascade to every capability row (FK ON DELETE CASCADE); services cascade to
  // provider_service_capabilities. provider_capability_audit is append-only by trigger and keeps
  // this run's rows (by design).
  await step("bookings", () => deleteBookingsForUsers(userIds));
  await step("payments", () => prisma.payment.deleteMany({ where: { userId: { in: userIds } } }));
  await step("walletTransactions", () => prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } }));
  await step("addresses", () => prisma.address.deleteMany({ where: { userId: { in: userIds } } }));
  await step("adminUsers", () => prisma.adminUser.deleteMany({ where: { userId: { in: userIds } } }));
  await step("providers", () => prisma.provider.deleteMany({ where: { userId: { in: userIds } } }));
  await step("users", () => prisma.user.deleteMany({ where: { id: { in: userIds } } }));
  await step("services", () => prisma.service.deleteMany({ where: { slug: { contains: TAG } } }));
  if (businessId) await step("business", () => prisma.$executeRaw`DELETE FROM businesses WHERE id = ${businessId}`);
  await step("skills", () => prisma.$executeRaw`DELETE FROM skills WHERE code LIKE ${`${RUN}-%`}`);
  if (failures.length) console.warn(`[p11-capabilities.integration] cleanup left residue: ${failures.join("; ")}`);
}, 60_000);

const skip = () => !dbOk || !deployed;

describe.serial("Phase 11 capability APIs through the real routes", () => {
  let certId = 0;
  let insuranceId = 0;
  let skillRowId = 0;
  let expiredCertId = 0;

  test("the skills catalogue is admin-owned: create, duplicate refused, partner cannot create", async () => {
    if (skip()) return;
    const r = await call("POST", "/api/admin/skills", { code: skillCode, category: "electrical", name: "Wiring" }, admin());
    expect(r.status).toBe(200);
    expect(r.json.data.skill).toMatchObject({ code: skillCode, active: true });
    expect((await call("POST", "/api/admin/skills", { code: skillCode2, category: "plumbing", name: "Plumbing" }, admin())).status).toBe(200);
    const dup = await call("POST", "/api/admin/skills", { code: skillCode, category: "electrical", name: "Again" }, admin());
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe("DUPLICATE");
    expect((await call("POST", "/api/admin/skills", { code: `${RUN}-x`, category: "c", name: "n" }, partner())).status).toBe(403);
    expect((await call("POST", "/api/admin/skills", { code: "Bad Code!", category: "c", name: "n" }, admin())).json.code).toBe("INVALID_CODE");
  });

  test("a partner declares skill / certification / equipment / insurance / language: DECLARED, SELF, the provider's data_origin", async () => {
    if (skip()) return;
    const skill = await partnerCall("POST", `${ME}/skills`, { skillCode, level: "SKILLED" });
    expect(skill.status).toBe(200);
    expect(skill.json.data.row).toMatchObject({ skillCode, level: "SKILLED", status: "DECLARED", source: "SELF", verifiedBy: null, verifiedAt: null, dataOrigin: EXPECTED_ORIGIN });
    skillRowId = skill.json.data.row.id;

    const cert = await partnerCall("POST", `${ME}/certifications`, { certificationType: "electrical-license", issuer: "State Board", issuedAt: iso(-400), expiresAt: iso(400) });
    expect(cert.status).toBe(200);
    expect(cert.json.data.row).toMatchObject({ certificationType: "electrical-license", status: "DECLARED", verifiedBy: null, dataOrigin: EXPECTED_ORIGIN });
    certId = cert.json.data.row.id;

    const eq = await partnerCall("POST", `${ME}/equipment`, { equipmentType: "ladder-6m", ownership: "OWNED" });
    expect(eq.status).toBe(200);
    expect(eq.json.data.row).toMatchObject({ equipmentType: "ladder-6m", status: "DECLARED", operational: "OPERATIONAL", dataOrigin: EXPECTED_ORIGIN });

    const ins = await partnerCall("POST", `${ME}/insurance`, { insuranceType: "public-liability", insurer: "ACME", effectiveFrom: iso(-10), expiresAt: iso(10) });
    expect(ins.status).toBe(200);
    expect(ins.json.data.row).toMatchObject({ insuranceType: "public-liability", status: "DECLARED", dataOrigin: EXPECTED_ORIGIN });
    insuranceId = ins.json.data.row.id;

    const lang = await partnerCall("POST", `${ME}/languages`, { languageCode: "hi", proficiency: "NATIVE" });
    expect(lang.status).toBe(200);
    expect(lang.json.data.row).toMatchObject({ languageCode: "hi", proficiency: "NATIVE", source: "SELF", active: true, dataOrigin: EXPECTED_ORIGIN });

    // The database agrees with the response, and nothing the partner wrote is VERIFIED.
    const origins = await prisma.$queryRaw<{ t: string; status: string; origin: string | null }[]>`
      SELECT 'skills' AS t, status, data_origin::text AS origin FROM provider_skills WHERE provider_id = ${ctx.providerId}
      UNION ALL SELECT 'certs', status, data_origin::text FROM provider_certifications WHERE provider_id = ${ctx.providerId}
      UNION ALL SELECT 'equipment', status, data_origin::text FROM provider_equipment WHERE provider_id = ${ctx.providerId}
      UNION ALL SELECT 'insurance', status, data_origin::text FROM provider_insurance WHERE provider_id = ${ctx.providerId}`;
    expect(origins.length).toBe(4);
    for (const o of origins) {
      expect(o.status).toBe("DECLARED");
      expect(o.origin).toBe(EXPECTED_ORIGIN);
    }
    // Input hygiene: unknown skill, inactive/invalid codes, bad dates, ISO 639-1 only.
    expect((await partnerCall("POST", `${ME}/skills`, { skillCode: `${RUN}-nope` })).json.code).toBe("SKILL_NOT_FOUND");
    expect((await partnerCall("POST", `${ME}/skills`, { skillCode, level: "GURU" })).json.code).toBe("INVALID_INPUT");
    expect((await partnerCall("POST", `${ME}/certifications`, { certificationType: "Electrical License" })).json.code).toBe("INVALID_CODE");
    expect((await partnerCall("POST", `${ME}/certifications`, { certificationType: "x-cert", issuedAt: iso(10), expiresAt: iso(-10) })).json.code).toBe("INVALID_INPUT");
    expect((await partnerCall("POST", `${ME}/languages`, { languageCode: "hindi" })).json.code).toBe("INVALID_CODE");
  });

  test("mass assignment: status / verifiedBy / dataOrigin / source in the body are ignored or refused, never stored", async () => {
    if (skip()) return;
    const r = await partnerCall("POST", `${ME}/skills`, { skillCode: skillCode2, level: "EXPERT", status: "VERIFIED", verifiedBy: ctx.superAdmin.id, verifiedAt: new Date().toISOString(), dataOrigin: "REAL", source: "ADMIN" });
    expect([200, 400, 422]).toContain(r.status);
    const rows = await prisma.$queryRaw<{ status: string; source: string; verified_by: string | null; verified_at: Date | null; origin: string | null }[]>`
      SELECT status, source, verified_by, verified_at, data_origin::text AS origin FROM provider_skills WHERE provider_id = ${ctx.providerId} AND skill_code = ${skillCode2}`;
    if (r.status === 200) {
      expect(rows).toEqual([{ status: "DECLARED", source: "SELF", verified_by: null, verified_at: null, origin: EXPECTED_ORIGIN }]);
    } else {
      expect(rows).toEqual([]);
    }
    const c = await partnerCall("POST", `${ME}/certifications`, { certificationType: "forged-cert", status: "VERIFIED", verifiedBy: ctx.superAdmin.id, dataOrigin: "REAL" });
    expect([200, 400, 422]).toContain(c.status);
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (
        SELECT 1 FROM provider_skills WHERE provider_id = ${ctx.providerId} AND (status = 'VERIFIED' OR verified_by IS NOT NULL OR data_origin::text = 'REAL' OR source <> 'SELF')
        UNION ALL SELECT 1 FROM provider_certifications WHERE provider_id = ${ctx.providerId} AND (status = 'VERIFIED' OR verified_by IS NOT NULL OR data_origin::text = 'REAL')
        UNION ALL SELECT 1 FROM provider_equipment WHERE provider_id = ${ctx.providerId} AND (status = 'VERIFIED' OR verified_by IS NOT NULL OR data_origin::text = 'REAL')
        UNION ALL SELECT 1 FROM provider_insurance WHERE provider_id = ${ctx.providerId} AND (status = 'VERIFIED' OR verified_by IS NOT NULL OR data_origin::text = 'REAL')
      ) x`;
    expect(Number(n)).toBe(0);
  });

  test("a document id must belong to the declaring provider", async () => {
    if (skip()) return;
    const r = await partnerCall("POST", `${ME}/certifications`, { certificationType: "gas-safety", documentId: otherDocId });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("DOCUMENT_NOT_FOUND");
    const ok = await partnerCall("POST", `${ME}/insurance`, { insuranceType: "vehicle", expiresAt: iso(90), documentId: verifiedDocId });
    expect(ok.status).toBe(200);
    expect(ok.json.data.row.documentId).toBe(verifiedDocId);
    const moved = await partnerCall("PATCH", `${ME}/insurance/${ok.json.data.row.id}`, { documentId: otherDocId });
    expect(moved.status).toBe(404);
    expect(moved.json.code).toBe("DOCUMENT_NOT_FOUND");
  });

  test("admin verify → VERIFIED with the admin as verifier, and the audit row carries actor_id + reason; a partner cannot verify", async () => {
    if (skip()) return;
    expect((await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${certId}/verify`, { reason: "licence checked against the board register" }, partner())).status).toBe(403);
    await assertNoPartnerActivation();
    const r = await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${certId}/verify`, { reason: "licence checked against the board register" }, admin());
    expect(r.status).toBe(200);
    expect(r.json.data.row).toMatchObject({ id: certId, status: "VERIFIED", verifiedBy: ctx.superAdmin.id, verificationSource: "ADMIN" });
    expect(r.json.data.row.verifiedAt).toBeTruthy();
    const audit = await lastAudit("provider_certifications", certId);
    expect(audit).toEqual({ action: "UPDATE", actor_type: "admin", actor_id: ctx.superAdmin.id, reason: "licence checked against the board register" });
    // Verify without a reason is allowed; the audit still names the actor and a default reason.
    const s = await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/skills/${skillRowId}/verify`, {}, admin());
    expect(s.status).toBe(200);
    expect(s.json.data.row).toMatchObject({ status: "VERIFIED", verifiedBy: ctx.superAdmin.id });
    const sa = await lastAudit("provider_skills", skillRowId);
    expect(sa?.actor_id).toBe(ctx.superAdmin.id);
    expect(sa?.reason).toBe("admin verify skills");
    // Verifying twice is an invalid transition, not a silent success.
    const again = await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${certId}/verify`, {}, admin());
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("INVALID_TRANSITION");
    // The wrong provider id in the path is a 404, never a cross-provider write.
    expect((await call("POST", `/api/admin/providers/${other.providerId}/capabilities/insurance/${insuranceId}/verify`, {}, admin())).status).toBe(404);
  });

  test("a partner cannot edit, re-declare or withdraw a VERIFIED row: 409 CAPABILITY_LOCKED", async () => {
    if (skip()) return;
    const edit = await partnerCall("PATCH", `${ME}/certifications/${certId}`, { expiresAt: iso(3000) });
    expect(edit.status).toBe(409);
    expect(edit.json.code).toBe("CAPABILITY_LOCKED");
    const re = await partnerCall("POST", `${ME}/skills`, { skillCode, level: "EXPERT" });
    expect(re.status).toBe(409);
    expect(re.json.code).toBe("CAPABILITY_LOCKED");
    const same = await partnerCall("POST", `${ME}/skills`, { skillCode, level: "SKILLED" });
    expect(same.status).toBe(200);
    expect(same.json.data.changed).toBe(false);
    const del = await partnerCall("DELETE", `${ME}/certifications/${certId}`);
    expect(del.status).toBe(409);
    const [row] = await prisma.$queryRaw<{ status: string; level: string | null }[]>`SELECT status, level FROM provider_skills WHERE id = ${skillRowId}`;
    expect(row).toEqual({ status: "VERIFIED", level: "SKILLED" });
    // A DECLARED row is still the partner's to edit — and stays DECLARED.
    const ok = await partnerCall("PATCH", `${ME}/insurance/${insuranceId}`, { insurer: "ACME Re" });
    expect(ok.status).toBe(200);
    expect(ok.json.data.row).toMatchObject({ insurer: "ACME Re", status: "DECLARED" });
  });

  test("a REJECTED claim is the partner's to withdraw; the verifier's identity never reaches a partner; the profile lists the codes services ask for", async () => {
    if (skip()) return;
    const declared = await partnerCall("POST", `${ME}/certifications`, { certificationType: "withdrawn-cert" });
    expect(declared.status).toBe(200);
    const rowId: number = declared.json.data.row.id;
    const rejected = await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${rowId}/reject`, { reason: "document is unreadable" }, admin());
    expect(rejected.status).toBe(200);
    expect(rejected.json.data.row.status).toBe("REJECTED");
    const withdrawn = await partnerCall("DELETE", `${ME}/certifications/${rowId}`);
    expect(withdrawn.status).toBe(200);
    expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM provider_certifications WHERE id = ${rowId}`).toEqual([]);
    // The rejected row's before-image survives the withdrawal in the append-only audit.
    const audit = await lastAudit("provider_certifications", rowId);
    expect(audit?.action).toBe("DELETE");

    // Re-declaring an unchanged VERIFIED skill returns the stored row — without the admin's id.
    const same = await partnerCall("POST", `${ME}/skills`, { skillCode, level: "SKILLED" });
    expect(same.status).toBe(200);
    expect(JSON.stringify(same.json)).not.toContain(ctx.superAdmin.id);
    if (same.json.data.row) expect(same.json.data.row.verifiedBy).toBe("ADMIN");

    const profile = await partnerCall("GET", ME);
    expect(profile.status).toBe(200);
    expect(JSON.stringify(profile.json)).not.toContain(ctx.superAdmin.id);
    const cat = profile.json.data.requirementCatalogue;
    for (const list of [cat.certifications, cat.equipment, cat.insurance]) {
      expect(Array.isArray(list)).toBe(true);
      expect(list.every((c: unknown) => typeof c === "string")).toBe(true);
    }
  });

  test("revoke needs a reason (400 REASON_REQUIRED); with one the row is REVOKED and cannot be re-verified", async () => {
    if (skip()) return;
    const none = await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${certId}/revoke`, {}, admin());
    expect(none.status).toBe(400);
    expect(none.json.code).toBe("REASON_REQUIRED");
    expect((await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${certId}/revoke`, { reason: "no" }, admin())).json.code).toBe("REASON_REQUIRED");
    const r = await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${certId}/revoke`, { reason: "licence suspended by the board" }, admin());
    expect(r.status).toBe(200);
    expect(r.json.data.row).toMatchObject({ status: "REVOKED", verifiedBy: null, revokedReason: "licence suspended by the board" });
    expect((await lastAudit("provider_certifications", certId))?.reason).toBe("licence suspended by the board");
    expect((await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${certId}/verify`, {}, admin())).json.code).toBe("INVALID_TRANSITION");
    // Admin fact correction also needs a reason.
    const p = await call("PATCH", `/api/admin/providers/${ctx.providerId}/capabilities/insurance/${insuranceId}`, { reason: "", expiresAt: iso(60) }, admin());
    expect(p.status).toBe(400);
    expect(p.json.code).toBe("REASON_REQUIRED");
  });

  test("the database refuses VERIFIED / ACTIVE rows without a verifier, whoever writes them", async () => {
    if (skip()) return;
    await sqlFails(prisma.$executeRaw`INSERT INTO provider_skills (provider_id, skill_code, status) VALUES (${other.providerId}, ${skillCode}, 'VERIFIED')`).toThrow(/provider_skills_verified_check/);
    await sqlFails(prisma.$executeRaw`INSERT INTO provider_certifications (provider_id, certification_type, status) VALUES (${other.providerId}, 'x-cert', 'VERIFIED')`).toThrow(/provider_certifications_verified_check/);
    await sqlFails(prisma.$executeRaw`INSERT INTO provider_service_capabilities (provider_id, service_id, status, source) VALUES (${other.providerId}, ${plainServiceId}, 'ACTIVE', 'SELF')`).toThrow(/provider_service_capabilities_active_check/);
    await sqlFails(prisma.$executeRaw`INSERT INTO provider_certifications (provider_id, certification_type, status) VALUES (${other.providerId}, 'x-cert', 'REVOKED')`).toThrow(/provider_certifications_revoked_check/);
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM provider_skills WHERE provider_id = ${other.providerId}`;
    expect(Number(n)).toBe(0);
    // And the audit is append-only.
    const [a] = await prisma.$queryRaw<{ id: bigint }[]>`SELECT id FROM provider_capability_audit WHERE table_name = 'provider_certifications' AND row_id = ${String(certId)} LIMIT 1`;
    await sqlFails(prisma.$executeRaw`DELETE FROM provider_capability_audit WHERE id = ${a.id}`).toThrow(/append-only/);
  });

  test("a service request is refused for a non-operational (DRAFT) service: 409 SERVICE_NOT_OPERATIONAL, no row", async () => {
    if (skip()) return;
    const r = await partnerCall("POST", `${ME}/services`, { serviceId: draftServiceId, note: "I can do this" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SERVICE_NOT_OPERATIONAL");
    expect(r.json.data.blocking).toContain("SERVICE_NOT_OPERATIONAL");
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM provider_service_capabilities WHERE provider_id = ${ctx.providerId}`;
    expect(Number(n)).toBe(0);
    expect((await partnerCall("POST", `${ME}/services`, { serviceId: "svc_does_not_exist" })).status).toBe(404);
  });

  test("a plain service request is REQUESTED/SELF; the signup service is grandfathered as LEGACY; the partner can withdraw only a REQUESTED row", async () => {
    if (skip()) return;
    const r = await partnerCall("POST", `${ME}/services`, { serviceId: plainServiceId, note: "trained last month" });
    expect(r.status).toBe(200);
    expect(r.json.data.row).toMatchObject({ serviceId: plainServiceId, status: "REQUESTED", source: "SELF", verifiedBy: null, dataOrigin: EXPECTED_ORIGIN });
    const rows = await prisma.$queryRaw<{ service_id: string; status: string; source: string }[]>`SELECT service_id, status, source FROM provider_service_capabilities WHERE provider_id = ${ctx.providerId} ORDER BY id`;
    expect(rows).toEqual([
      { service_id: signupServiceId, status: "ACTIVE", source: "LEGACY" },
      { service_id: plainServiceId, status: "REQUESTED", source: "SELF" },
    ]);
    // Asking again for a service already held (ACTIVE or REQUESTED) is idempotent: no second row, no state change.
    const held = await partnerCall("POST", `${ME}/services`, { serviceId: signupServiceId });
    expect(held.status).toBe(200);
    expect(held.json.data).toMatchObject({ changed: false, row: { status: "ACTIVE", source: "LEGACY" } });
    expect((await partnerCall("POST", `${ME}/services`, { serviceId: plainServiceId })).json.data.changed).toBe(false);
    expect((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM provider_service_capabilities WHERE provider_id = ${ctx.providerId}`)[0].n).toBe(2n);
    // Only the REQUESTED row can be withdrawn; the grandfathered ACTIVE row cannot.
    const legacyId = (await prisma.$queryRaw<{ id: bigint }[]>`SELECT id FROM provider_service_capabilities WHERE provider_id = ${ctx.providerId} AND service_id = ${signupServiceId}`)[0].id;
    expect((await partnerCall("DELETE", `${ME}/services/${legacyId}`)).status).toBe(409);
    const w = await partnerCall("DELETE", `${ME}/services/${r.json.data.row.id}`);
    expect(w.status).toBe(200);
    expect((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM provider_service_capabilities WHERE provider_id = ${ctx.providerId} AND service_id = ${plainServiceId}`)[0].n).toBe(0n);
  });

  test("a business service needs an admin-recorded membership: 409 without, REQUESTED with, ACTIVE only after admin approve", async () => {
    if (skip()) return;
    const b = await call("POST", "/api/admin/businesses", { name: `Adv Facilities ${RUN}`, reason: "onboarded facilities partner" }, admin());
    expect(b.status).toBe(200);
    businessId = b.json.data.business.id;
    expect((await call("PUT", `/api/admin/services/${bizServiceId}/business`, { businessId, reason: "x" }, admin())).json.code).toBe("REASON_REQUIRED");
    const own = await call("PUT", `/api/admin/services/${bizServiceId}/business`, { businessId, reason: "service is delivered under this business" }, admin());
    expect(own.status).toBe(200);
    expect(own.json.data).toMatchObject({ serviceId: bizServiceId, businessId, changed: true });
    const ownAudit = await prisma.$queryRaw<{ actor_id: string | null; reason: string | null }[]>`SELECT actor_id, reason FROM provider_capability_audit WHERE table_name = 'services' AND row_id = ${bizServiceId} ORDER BY id DESC LIMIT 1`;
    expect(ownAudit[0]).toEqual({ actor_id: ctx.superAdmin.id, reason: "service is delivered under this business" });

    const denied = await partnerCall("POST", `${ME}/services`, { serviceId: bizServiceId });
    expect(denied.status).toBe(409);
    expect(denied.json.code).toBe("BUSINESS_NOT_AUTHORIZED");
    expect(denied.json.data.blocking).toEqual(["BUSINESS_NOT_AUTHORIZED"]);
    // An admin cannot approve past the membership gate either.
    const early = await call("POST", `/api/admin/providers/${ctx.providerId}/services/${bizServiceId}/approve`, {}, admin());
    expect(early.status).toBe(409);
    expect(early.json.code).toBe("BUSINESS_NOT_AUTHORIZED");
    // Only an admin records a membership; a partner cannot.
    expect((await call("POST", `/api/admin/businesses/${businessId}/providers/${ctx.providerId}`, { role: "MEMBER" }, partner())).status).toBe(403);
    const m = await call("POST", `/api/admin/businesses/${businessId}/providers/${ctx.providerId}`, { role: "MEMBER", reason: "employment letter on file" }, admin());
    expect(m.status).toBe(200);
    expect(m.json.data.membership).toMatchObject({ businessId, providerId: ctx.providerId, role: "MEMBER", active: true, verifiedBy: ctx.superAdmin.id });

    const req = await partnerCall("POST", `${ME}/services`, { serviceId: bizServiceId });
    expect(req.status).toBe(200);
    expect(req.json.data.row).toMatchObject({ serviceId: bizServiceId, status: "REQUESTED", source: "SELF", verifiedBy: null });

    const pending = await call("GET", "/api/admin/service-skill-requests", undefined, admin());
    expect(pending.status).toBe(200);
    expect(pending.json.data.requests.some((p: { providerId: string; serviceId: string }) => p.providerId === ctx.providerId && p.serviceId === bizServiceId)).toBe(true);

    const ap = await call("POST", `/api/admin/providers/${ctx.providerId}/services/${bizServiceId}/approve`, {}, admin());
    expect(ap.status).toBe(200);
    expect(ap.json.data.row).toMatchObject({ serviceId: bizServiceId, status: "ACTIVE", source: "SELF", verifiedBy: ctx.superAdmin.id });
    adminActivated.add(bizServiceId);
    const audit = await lastAudit("provider_service_capabilities", ap.json.data.row.id);
    expect(audit).toMatchObject({ action: "UPDATE", actor_type: "admin", actor_id: ctx.superAdmin.id });
    const prov = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId }, select: { serviceCategories: true } });
    expect(prov.serviceCategories).toContain(bizServiceId);
    await assertNoPartnerActivation();

    // Suspend needs a reason and takes the token away again.
    expect((await call("POST", `/api/admin/providers/${ctx.providerId}/services/${bizServiceId}/suspend`, {}, admin())).json.code).toBe("REASON_REQUIRED");
    const sus = await call("POST", `/api/admin/providers/${ctx.providerId}/services/${bizServiceId}/suspend`, { reason: "complaint under review" }, admin());
    expect(sus.json.data.row.status).toBe("SUSPENDED");
    adminActivated.delete(bizServiceId);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId }, select: { serviceCategories: true } })).serviceCategories).not.toContain(bizServiceId);
    // A SUSPENDED row is not the partner's to re-request or withdraw.
    expect((await partnerCall("POST", `${ME}/services`, { serviceId: bizServiceId })).json.code).toBe("CAPABILITY_LOCKED");
    expect((await partnerCall("DELETE", `${ME}/services/${ap.json.data.row.id}`)).status).toBe(409);
  });

  test("membership ends when an admin removes it; the other partner (no membership) is refused", async () => {
    if (skip()) return;
    expect((await call("POST", `/api/admin/providers/${other.providerId}/services/${bizServiceId}/approve`, {}, admin())).json.code).toBe("BUSINESS_NOT_AUTHORIZED");
    const rm = await call("DELETE", `/api/admin/businesses/${businessId}/providers/${ctx.providerId}`, { reason: "left the company" }, admin());
    expect(rm.status).toBe(200);
    expect(rm.json.data.membership.active).toBe(false);
    const again = await call("POST", `/api/admin/providers/${ctx.providerId}/services/${bizServiceId}/approve`, {}, admin());
    expect(again.json.code).toBe("BUSINESS_NOT_AUTHORIZED");
  });

  test("another partner sees none of it and can change none of it (404), and an admin route refuses a partner token", async () => {
    if (skip()) return;
    const mine = await partnerCall("GET", ME, undefined, otherPartner());
    expect(mine.status).toBe(200);
    expect(mine.json.data.providerId).toBe(other.providerId);
    expect(mine.json.data.certifications).toEqual([]);
    expect(mine.json.data.skills).toEqual([]);
    expect(mine.json.data.services).toEqual([]);
    expect(mine.json.data.skillCatalogue.some((s: { code: string }) => s.code === skillCode)).toBe(true);
    expect((await partnerCall("PATCH", `${ME}/insurance/${insuranceId}`, { insurer: "hijack" }, otherPartner())).status).toBe(404);
    expect((await partnerCall("DELETE", `${ME}/insurance/${insuranceId}`, undefined, otherPartner())).status).toBe(404);
    expect((await partnerCall("DELETE", `${ME}/skills/${skillRowId}`, undefined, otherPartner())).status).toBe(404);
    expect((await call("GET", `/api/admin/providers/${ctx.providerId}/capabilities`, undefined, otherPartner())).status).toBe(403);
    const [row] = await prisma.$queryRaw<{ insurer: string | null }[]>`SELECT insurer FROM provider_insurance WHERE id = ${insuranceId}`;
    expect(row.insurer).toBe("ACME Re");
    // The partner view hides the verifier's user id; the admin view shows it.
    const me = await partnerCall("GET", ME);
    const skill = me.json.data.skills.find((s: { id: number }) => s.id === skillRowId);
    expect(skill.status).toBe("VERIFIED");
    expect(skill.verifiedBy).toBeUndefined();
    const adminView = await call("GET", `/api/admin/providers/${ctx.providerId}/capabilities`, undefined, admin());
    expect(adminView.json.data.skills.find((s: { id: number }) => s.id === skillRowId).verifiedBy).toBe(ctx.superAdmin.id);
    expect(Array.isArray(adminView.json.data.audit)).toBe(true);
    expect(adminView.json.data.audit.length).toBeGreaterThan(0);
  });

  test("admin document verify is bound to the provider in the path (404 for the wrong provider)", async () => {
    if (skip()) return;
    const wrong = await call("PUT", `/api/admin/providers/${ctx.providerId}/documents/${otherDocId}/verify`, {}, admin());
    expect(wrong.status).toBe(404);
    expect((await prisma.providerDocument.findUniqueOrThrow({ where: { id: otherDocId }, select: { isVerified: true } })).isVerified).toBe(false);
    const wrongReject = await call("PUT", `/api/admin/providers/${ctx.providerId}/documents/${otherDocId}/reject`, { reason: "blurry" }, admin());
    expect(wrongReject.status).toBe(404);
    const right = await call("PUT", `/api/admin/providers/${other.providerId}/documents/${otherDocId}/verify`, { notes: "ok" }, admin());
    expect(right.status).toBe(200);
    expect((await prisma.providerDocument.findUniqueOrThrow({ where: { id: otherDocId }, select: { isVerified: true } })).isVerified).toBe(true);
  });

  test("a partner cannot push out the expiry of a verified document: 409 DOCUMENT_LOCKED", async () => {
    if (skip()) return;
    const before = await prisma.providerDocument.findUniqueOrThrow({ where: { id: verifiedDocId }, select: { expiryDate: true } });
    const r = await call("PATCH", `/api/providers/me/documents/${verifiedDocId}`, { expiryDate: iso(3000) }, partner());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("DOCUMENT_LOCKED");
    const after = await prisma.providerDocument.findUniqueOrThrow({ where: { id: verifiedDocId }, select: { expiryDate: true } });
    expect(after.expiryDate?.getTime()).toBe(before.expiryDate?.getTime());
    // Someone else's document is not theirs to edit at all.
    expect((await call("PATCH", `/api/providers/me/documents/${otherDocId}`, { expiryDate: iso(3000) }, partner())).status).toBe(403);
  });

  test("validity is arithmetic: EXPIRED / UNVERIFIED / near-expiry in the admin profile; an expired claim cannot be verified", async () => {
    if (skip()) return;
    const exp = await partnerCall("POST", `${ME}/certifications`, { certificationType: "first-aid", issuedAt: iso(-800), expiresAt: iso(-1) });
    expect(exp.status).toBe(200);
    expiredCertId = exp.json.data.row.id;
    const cantVerify = await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${expiredCertId}/verify`, {}, admin());
    expect(cantVerify.status).toBe(409);
    expect(cantVerify.json.code).toBe("CAPABILITY_EXPIRED");
    expect((await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/certifications/${expiredCertId}/verify`, { expiresAt: iso(-5) }, admin())).json.code).toBe("CAPABILITY_EXPIRED");

    let view = await call("GET", `/api/admin/providers/${ctx.providerId}/capabilities`, undefined, admin());
    expect(view.status).toBe(200);
    const byId = (list: Array<{ id: number }>, id: number) => list.find((r) => r.id === id) as any;
    expect(byId(view.json.data.certifications, expiredCertId)).toMatchObject({ validity: "EXPIRED", nearExpiry: false, status: "DECLARED" });
    expect(byId(view.json.data.certifications, certId)).toMatchObject({ validity: "REVOKED" });
    expect(byId(view.json.data.insurance, insuranceId)).toMatchObject({ validity: "UNVERIFIED", nearExpiry: true, status: "DECLARED" });
    expect(view.json.data.summary.expired).toBeGreaterThanOrEqual(1);
    expect(view.json.data.summary.pendingReview).toBeGreaterThanOrEqual(1);

    // Verified with 10 days left: VALID and near expiry — expiry is a column, not a claim.
    const v = await call("POST", `/api/admin/providers/${ctx.providerId}/capabilities/insurance/${insuranceId}/verify`, { reason: "policy document checked" }, admin());
    expect(v.status).toBe(200);
    view = await call("GET", `/api/admin/providers/${ctx.providerId}/capabilities`, undefined, admin());
    expect(byId(view.json.data.insurance, insuranceId)).toMatchObject({ validity: "VALID", nearExpiry: true, status: "VERIFIED", verifiedBy: ctx.superAdmin.id });
    expect(view.json.data.summary.nearExpiry).toBeGreaterThanOrEqual(1);
    // An admin correction that moves the expiry into the past makes it EXPIRED at once (reason recorded).
    const p = await call("PATCH", `/api/admin/providers/${ctx.providerId}/capabilities/insurance/${insuranceId}`, { reason: "insurer confirmed the policy lapsed", expiresAt: iso(-1) }, admin());
    expect(p.status).toBe(200);
    view = await call("GET", `/api/admin/providers/${ctx.providerId}/capabilities`, undefined, admin());
    expect(byId(view.json.data.insurance, insuranceId)).toMatchObject({ validity: "EXPIRED", status: "VERIFIED" });
    expect((await lastAudit("provider_insurance", insuranceId))?.reason).toBe("insurer confirmed the policy lapsed");
    // The partner may not "fix" that by editing the verified row.
    expect((await partnerCall("PATCH", `${ME}/insurance/${insuranceId}`, { expiresAt: iso(365) })).json.code).toBe("CAPABILITY_LOCKED");
  });

  test("Q16 closing check: after every partner call above, no partner-sourced row ever reached ACTIVE by itself", async () => {
    if (skip()) return;
    await assertNoPartnerActivation();
    const partnerActivated = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM provider_capability_audit
      WHERE table_name = 'provider_service_capabilities' AND provider_id = ${ctx.providerId}
        AND actor_type = 'partner' AND after->>'status' = 'ACTIVE' AND after->>'source' <> 'LEGACY'`;
    expect(Number(partnerActivated[0].n)).toBe(0);
    const partnerVerified = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM provider_capability_audit
      WHERE provider_id = ${ctx.providerId} AND actor_type = 'partner'
        AND table_name IN ('provider_skills', 'provider_certifications', 'provider_equipment', 'provider_insurance')
        AND after->>'status' = 'VERIFIED'`;
    expect(Number(partnerVerified[0].n)).toBe(0);
  });
});
