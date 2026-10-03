import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { prisma, dbReachable, seedAdversarialFixtures, cleanupAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { chargebackEvidenceAccessService } from "../services/chargeback-evidence-access.service";
import { objectStorageService } from "../services/object-storage.service";
import { generateStorageKey } from "../lib/storage-key";

/**
 * P0-2 Chargeback evidence access control — against the REAL guard.
 *
 * The previous version of this file defined its own `validateTokenAccess()` mock at the top and
 * tested that mock's branches; the production guard could have had no check at all and the suite
 * stayed green. Every case below goes through `consumeDownloadToken`.
 */
const RUN = `cbacc-${Date.now().toString(36)}`;
let ctx: AdvCtx | null = null;
let evidenceId = "";
const spies: Array<{ mockRestore: () => void }> = [];

beforeAll(async () => {
  if (!(await dbReachable())) return;
  ctx = await seedAdversarialFixtures(RUN);
  const chargeback = await prisma.chargeback.create({
    data: { amount: 500, amountPaise: 50_000n, razorpayDisputeId: `disp_${RUN}` },
  });
  const evidence = await prisma.chargebackEvidence.create({
    data: {
      chargebackId: chargeback.id,
      storageKey: `${generateStorageKey()}-${RUN}.pdf`,
      fileName: "evidence.pdf",
      mimeType: "application/pdf",
      uploadedBy: ctx.financeAdmin.id,
    },
  });
  evidenceId = evidence.id;
}, 60_000);
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});
afterAll(async () => {
  if (!ctx) return;
  await prisma.chargeback.deleteMany({ where: { razorpayDisputeId: `disp_${RUN}` } });
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

const issue = (adminId: string) => chargebackEvidenceAccessService.createDownloadToken(evidenceId, adminId);
const consume = (token: string, adminId: string) =>
  (async () => chargebackEvidenceAccessService.consumeDownloadToken(token, adminId))();

describe("P0-2 Chargeback evidence access control", () => {
  test("an unknown token is refused before any storage access", async () => {
    if (!ctx) return;
    const head = spyOn(objectStorageService, "headObject");
    spies.push(head);
    await expect(consume("not-a-token", ctx.financeAdmin.id)).rejects.toThrow(/FORBIDDEN/);
    expect(head).not.toHaveBeenCalled();
  });

  test("a token issued to one admin cannot be used by another admin, and the attempt does not burn it", async () => {
    if (!ctx) return;
    const { token } = await issue(ctx.financeAdmin.id);
    await expect(consume(token, ctx.supportAdmin.id)).rejects.toThrow(/not issued to this admin/);
    const row = await prisma.chargebackEvidenceDownloadToken.findUniqueOrThrow({ where: { token } });
    expect(row.usedAt).toBeNull();
  });

  test("the issuing admin can download once; the second use is refused", async () => {
    if (!ctx) return;
    const head = spyOn(objectStorageService, "headObject").mockResolvedValue(true);
    const s3 = spyOn(objectStorageService, "isS3Enabled").mockReturnValue(true);
    const get = spyOn(objectStorageService, "getObjectBuffer").mockResolvedValue(Buffer.from("%PDF-1.4"));
    spies.push(head, s3, get);
    const { token } = await issue(ctx.financeAdmin.id);
    const first = await chargebackEvidenceAccessService.consumeDownloadToken(token, ctx.financeAdmin.id);
    expect(first.evidenceId).toBe(evidenceId);
    expect(first.fileName).toBe("evidence.pdf");
    await expect(consume(token, ctx.financeAdmin.id)).rejects.toThrow(/already used/);
  });

  test("an expired token is refused even for the issuing admin", async () => {
    if (!ctx) return;
    const { token } = await issue(ctx.financeAdmin.id);
    await prisma.chargebackEvidenceDownloadToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(consume(token, ctx.financeAdmin.id)).rejects.toThrow(/expired/);
  });

  test("a valid token whose file is missing is NOT_FOUND, not a silent success", async () => {
    if (!ctx) return;
    const head = spyOn(objectStorageService, "headObject").mockResolvedValue(false);
    spies.push(head);
    const { token } = await issue(ctx.financeAdmin.id);
    await expect(consume(token, ctx.financeAdmin.id)).rejects.toThrow(/NOT_FOUND/);
  });
});
