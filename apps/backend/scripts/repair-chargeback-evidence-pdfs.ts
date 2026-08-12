/**
 * Upgrade chargeback evidence files to premium legal evidence packs.
 * Usage: bun --env-file=.env run scripts/repair-chargeback-evidence-pdfs.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import {
  chargebackEvidencePdfService,
  isPremiumEvidencePdf,
} from "../src/services/chargeback-evidence-pdf.service";
import { objectStorageService } from "../src/services/object-storage.service";

async function main() {
  const rows = await prisma.chargebackEvidence.findMany({
    where: { mimeType: "application/pdf" },
    select: { id: true, storageKey: true, fileName: true, chargebackId: true },
  });

  let repaired = 0;
  for (const row of rows) {
    let buf: Buffer;
    try {
      buf = await objectStorageService.getObjectBuffer("chargeback-evidence", row.storageKey);
    } catch {
      console.warn(`skip ${row.id}: file missing`);
      continue;
    }
    if (isPremiumEvidencePdf(buf)) {
      console.log(`premium ok ${row.fileName} (${row.id}) ${buf.length}B`);
      continue;
    }

    const pack = await chargebackEvidencePdfService.generateLegalPack(row.chargebackId);
    await objectStorageService.putObject("chargeback-evidence", pack.buffer, {
      fileName: pack.fileName,
      mimeType: "application/pdf",
      storageKey: row.storageKey,
    });
    await prisma.chargebackEvidence.update({
      where: { id: row.id },
      data: { fileName: pack.fileName, description: `Legal evidence pack ${pack.documentId}` },
    });
    repaired++;
    console.log(`upgraded ${row.fileName} -> ${pack.fileName} (${row.id}) ${buf.length}B -> ${pack.buffer.length}B`);
  }
  console.log(`Done. Upgraded ${repaired}/${rows.length} evidence file(s) to premium legal packs.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
