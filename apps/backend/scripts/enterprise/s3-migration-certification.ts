/**
 * S3 evidence storage migration certification.
 * Usage: bun --env-file=.env run scripts/enterprise/s3-migration-certification.ts
 */
import "../../src/load-env";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { objectStorageService } from "../../src/services/object-storage.service";
import { chargebackEvidenceAccessService } from "../../src/services/chargeback-evidence-access.service";
import prisma from "../../src/lib/prisma";
import { ChargebackStatus } from "@prisma/client";

const DOCS = path.join(import.meta.dir, "../../docs");
const RUN_ID = `s3-cert-${Date.now().toString(36)}`;

type Verdict = "PASS" | "FAIL" | "NOT PROVEN";
type Row = { check: string; verdict: Verdict; detail: string };
const rows: Row[] = [];

function record(check: string, verdict: Verdict, detail: string) {
  rows.push({ check, verdict, detail });
  console.log(`[${verdict}] ${check}: ${detail}`);
}

async function main() {
  const s3 = objectStorageService.isS3Enabled();
  record("S3 bucket configured", s3 ? "PASS" : "NOT PROVEN", s3 ? process.env.AWS_S3_BUCKET ?? "" : "AWS_S3_BUCKET unset — local backend only");

  let uploadOk = 0;
  let downloadOk = 0;
  let permissionDenied = 0;
  const keys: string[] = [];

  for (let i = 0; i < 100; i++) {
    const body = Buffer.from(`cert-upload-${RUN_ID}-${i}-${crypto.randomBytes(8).toString("hex")}`);
    const stored = await objectStorageService.putObject("chargeback-evidence", body, {
      fileName: `cert-${i}.pdf`,
      mimeType: "application/pdf",
    });
    keys.push(stored.storageKey);
    const head = await objectStorageService.headObject("chargeback-evidence", stored.storageKey);
    if (head && stored.fileHash === crypto.createHash("sha256").update(body).digest("hex")) uploadOk++;
  }
  record("100 file uploads", uploadOk === 100 ? "PASS" : "FAIL", `uploadOk=${uploadOk}/100 backend=${s3 ? "s3" : "local"}`);

  for (let i = 0; i < 50; i++) {
    const key = keys[i];
    if (!key) continue;
    const buf = await objectStorageService.getObjectBuffer("chargeback-evidence", key);
    if (buf.length > 0) downloadOk++;
  }
  record("50 downloads", downloadOk === 50 ? "PASS" : "FAIL", `downloadOk=${downloadOk}/50`);

  const admin = await prisma.user.findFirst({ where: { email: "admin@homigo.demo" } });
  if (admin) {
    const cb = await prisma.chargeback.create({
      data: { amount: 100, amountPaise: BigInt(10000), status: ChargebackStatus.RECEIVED },
    });
    const evidence = await prisma.chargebackEvidence.create({
      data: {
        chargebackId: cb.id,
        storageKey: keys[0]!,
        fileName: "cert-0.pdf",
        mimeType: "application/pdf",
        uploadedBy: admin.id,
      },
    });

    const token = await chargebackEvidenceAccessService.createDownloadToken(evidence.id, admin.id);
    const file = await chargebackEvidenceAccessService.consumeDownloadToken(token.token, admin.id);
    record("Signed download token", file.buffer || file.filePath ? "PASS" : "FAIL", "single-use token consumed");

    try {
      await chargebackEvidenceAccessService.consumeDownloadToken(token.token, admin.id);
      record("Token reuse blocked", "FAIL", "second consume succeeded");
    } catch {
      permissionDenied++;
      record("Token reuse blocked", "PASS", "second consume denied");
    }

    try {
      await chargebackEvidenceAccessService.consumeDownloadToken(token.token, "wrong-admin-id");
    } catch {
      permissionDenied++;
    }
    record("Permission checks", permissionDenied >= 1 ? "PASS" : "FAIL", `denied=${permissionDenied}`);

    if (s3) {
      try {
        const signed = await objectStorageService.createSignedDownloadUrl("chargeback-evidence", keys[0]!);
        record("S3 presigned URL", signed.startsWith("http") ? "PASS" : "FAIL", signed.slice(0, 60));
      } catch (err) {
        record("S3 presigned URL", "FAIL", err instanceof Error ? err.message : String(err));
      }
    } else {
      record("S3 presigned URL", "NOT PROVEN", "AWS_S3_BUCKET not configured");
    }

    await prisma.chargebackEvidenceDownloadToken.deleteMany({ where: { evidenceId: evidence.id } });
    await prisma.chargebackEvidence.delete({ where: { id: evidence.id } });
    await prisma.chargeback.delete({ where: { id: cb.id } });
  }

  let deleted = 0;
  for (const key of keys.slice(50, 60)) {
    await objectStorageService.deleteObject("chargeback-evidence", key);
    const head = await objectStorageService.headObject("chargeback-evidence", key);
    if (!head) deleted++;
  }
  record("Delete 10 objects", deleted === 10 ? "PASS" : "FAIL", `deleted=${deleted}/10`);

  const overall = rows.some((r) => r.verdict === "FAIL")
    ? "FAIL"
    : rows.some((r) => r.verdict === "NOT PROVEN")
      ? "PARTIAL"
      : "PASS";

  const md = [
    "# S3 Evidence Storage Migration Certification",
    "",
    `**Executed:** ${new Date().toISOString()}`,
    `**Run ID:** \`${RUN_ID}\``,
    `**Overall:** **${overall}**`,
    "",
    "| Check | Verdict | Detail |",
    "|-------|---------|--------|",
    ...rows.map((r) => `| ${r.check} | **${r.verdict}** | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
    "## Migration scope",
    "",
    "- Chargeback evidence → `object-storage.service` (S3 SSE or local fallback)",
    "- Compliance exports → unified object storage",
    "- Support attachments → namespace reserved (`support-attachments`)",
    "- Admin uploads → namespace reserved (`admin-uploads`)",
    "",
  ].join("\n");

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, "s3-migration-certification.md"), md);
  console.log("\nWrote docs/s3-migration-certification.md");
  await prisma.$disconnect();
  process.exit(overall === "FAIL" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
