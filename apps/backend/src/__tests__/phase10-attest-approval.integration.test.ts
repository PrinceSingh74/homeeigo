/**
 * Phase 10 — owner attestation of content applied under a placeholder approver, end to end on the
 * isolated test DB.
 *
 * Reproduces the live homigo_db shape of 2026-09-29 through the canonical admin write: the draft content
 * is applied with the apply-plan's own reason ("… hash <16> · approved by YOUR NAME (…)"), then a later
 * change to a non-content key bumps the version (live: the E2 / E applies). The real CLI then reports,
 * attests, and re-runs. Proves: the placeholder apply row is kept byte-for-byte; exactly one attestation
 * row is appended; the catalogue is not touched; a re-run writes nothing; content that is not the
 * approved draft is never attested.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSyncFreshClock } from "./helpers/fresh-loop-clock";
import { join } from "node:path";
import prisma from "../lib/prisma";
import app from "../index";
import { DRAFT, DRAFT_VERSION } from "../../scripts/data/phase-10-execution-safety-content-draft";
import { buildNextConfig, contentHash } from "../../scripts/phase10-content-apply-plan";
import { ATTESTATION_ACTION, classifyApprovalProvenance } from "../../scripts/lib/approval-provenance";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `p10attest-${Date.now().toString(36)}`;
const SLUG = "sofa-deep-cleaning";
const HASH = contentHash(SLUG);
const PLACEHOLDER_REASON = `Phase 10 execution/safety/quality content ${DRAFT_VERSION} · ${SLUG} · hash ${HASH.slice(0, 16)} · approved by YOUR NAME (2026-09-29T05:24:02.246Z)`;
let ctx: AdvCtx;
let dbOk = false;

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const admin = () => bearer(ctx.superAdmin);
const BASE = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }],
  variantRequired: true,
  addons: [] as unknown[],
  requirements: [] as unknown[],
  quality: { warrantyDays: 7 },
};

// Clock-safe timed spawn (helpers/fresh-loop-clock): a stale loop clock expired this timeout at once.
async function attest(extra: string[]) {
  const r = await spawnSyncFreshClock(process.execPath, ["run", "scripts/phase10-attest-approval.ts", "--url", process.env.DATABASE_URL!, "--services", SLUG, "--map", `${SLUG}=${ctx.serviceId}`, "--approved-by", "Asha Rao", ...extra], {
    cwd: join(import.meta.dir, "..", ".."),
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const rowsFor = () =>
  prisma.activityLog.findMany({ where: { action: "ADMIN_ACTION", description: { contains: ctx.serviceId } }, select: { description: true }, orderBy: { createdAt: "desc" } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const base = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: BASE, changeReason: "phase10 attest test: base" }, admin());
  if (base.status !== 200) throw new Error(`service base: ${JSON.stringify(base.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("owner attestation of content applied under a placeholder", () => {
  let placeholderRow = "";
  let versionBeforeAttest = 0;

  test("content that is not the approved draft is never attested", async () => {
    if (!dbOk) return;
    const r = await attest([]);
    expect(r.out).toContain(`${SLUG}: NOT_IDENTICAL`);
    expect(r.status).toBe(1);
  }, 90_000);

  test("setup: apply the draft under a placeholder reason, then bump the version on a non-content key (the live shape)", async () => {
    if (!dbOk) return;
    const s = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true, catalogConfig: true } });
    const next = buildNextConfig(s.catalogConfig, DRAFT[SLUG]!);
    const a = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: next, expectedVersion: s.version, changeReason: PLACEHOLDER_REASON }, admin());
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    const s2 = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true, catalogConfig: true } });
    const bumped = { ...(s2.catalogConfig as Record<string, unknown>), quantity: { ...BASE.quantity, default: 2 } };
    const b = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: bumped, expectedVersion: s2.version, changeReason: "phase10 attest test: non-content change" }, admin());
    expect(b.status, JSON.stringify(b.json)).toBe(200);
    // The audit write is fire-and-forget inside the request; wait until the placeholder row is visible.
    for (let i = 0; i < 50 && !placeholderRow; i++) {
      placeholderRow = (await rowsFor()).find((r) => r.description?.includes("approved by YOUR NAME"))?.description ?? "";
      if (!placeholderRow) await Bun.sleep(100);
    }
    expect(placeholderRow).toContain("approved by YOUR NAME");
    const s3 = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true } });
    versionBeforeAttest = s3.version;
    const p = classifyApprovalProvenance(await rowsFor(), { serviceId: ctx.serviceId, version: s3.version, contentHash: HASH });
    expect(p).toEqual({ kind: "PLACEHOLDER", approver: "YOUR NAME" });
  }, 60_000);

  test("report mode names what it would attest and writes nothing", async () => {
    if (!dbOk) return;
    const before = (await rowsFor()).length;
    const r = await attest([]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`${SLUG}: WOULD_ATTEST v${versionBeforeAttest} hash ${HASH.slice(0, 16)} (supersedes: apply signed by placeholder "YOUR NAME")`);
    expect((await rowsFor()).length).toBe(before);
  }, 90_000);

  test("--apply appends exactly one attestation, keeps the placeholder row byte-for-byte, and changes no content", async () => {
    if (!dbOk) return;
    const r = await attest(["--apply", "--actor-id", ctx.superAdmin.id, "--note", "given in writing by the owner; executed by the operator session"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`${SLUG}: ATTESTED v${versionBeforeAttest}`);
    const rows = await rowsFor();
    const attestations = rows.filter((x) => x.description?.includes(ATTESTATION_ACTION));
    expect(attestations).toHaveLength(1);
    const d = JSON.parse(attestations[0]!.description!) as Record<string, unknown>;
    expect(d).toMatchObject({ action: ATTESTATION_ACTION, serviceId: ctx.serviceId, slug: SLUG, version: versionBeforeAttest, contentHash: HASH, draftVersion: DRAFT_VERSION, approvedBy: "Asha Rao", supersedes: 'apply signed by placeholder "YOUR NAME"', note: "given in writing by the owner; executed by the operator session" });
    expect(rows.filter((x) => x.description === placeholderRow)).toHaveLength(1); // history untouched
    const s = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true } });
    expect(s.version).toBe(versionBeforeAttest); // no catalogue write
    expect(classifyApprovalProvenance(rows, { serviceId: ctx.serviceId, version: s.version, contentHash: HASH })).toEqual({ kind: "ATTESTED", approver: "Asha Rao" });
  }, 90_000);

  test("--note is recorded on a new attestation (how it was given), and is refused when it is a placeholder", async () => {
    if (!dbOk) return;
    // A fresh slug for this case: the first attestation above already covers SLUG.
    const r = await attest(["--note", "<note>"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--note");
  }, 90_000);

  test("a second --apply is a no-op", async () => {
    if (!dbOk) return;
    const r = await attest(["--apply", "--actor-id", ctx.superAdmin.id]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`${SLUG}: SKIP_ALREADY_PROVEN (ATTESTED by Asha Rao)`);
    expect((await rowsFor()).filter((x) => x.description?.includes(ATTESTATION_ACTION))).toHaveLength(1);
  }, 90_000);

  test("--apply refuses an actor that is not an active SUPER_ADMIN", async () => {
    if (!dbOk) return;
    const r = await attest(["--apply", "--actor-id", ctx.customerA.id]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("not an active SUPER_ADMIN");
  }, 90_000);
});
