import crypto from "crypto";
import { objectStorageService } from "../services/object-storage.service";
import { logger } from "./logger";

export type StoredExport = {
  fileUrl: string;
  fileStorageKey: string;
  fileSize: number;
  fileHash: string;
};

export async function storeComplianceExport(
  userId: string,
  zipBytes: Uint8Array,
): Promise<StoredExport> {
  const fileHash = crypto.createHash("sha256").update(zipBytes).digest("hex");
  const fileName = `data-export-${userId}-${crypto.randomUUID()}.zip`;

  const stored = await objectStorageService.putObject("compliance-exports", Buffer.from(zipBytes), {
    fileName,
    mimeType: "application/zip",
  });

  if (stored.backend === "local") {
    logger.info("compliance_export_stored_local", { userId, fileName });
    return {
      fileUrl: `/uploads/compliance-exports/${stored.storageKey}`,
      fileStorageKey: stored.storageKey,
      fileSize: stored.fileSize,
      fileHash,
    };
  }

  return {
    fileUrl: stored.fileUrl ?? "",
    fileStorageKey: stored.storageKey,
    fileSize: stored.fileSize,
    fileHash,
  };
}
