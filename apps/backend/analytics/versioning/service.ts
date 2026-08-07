/**
 * Data Versioning — dataset, feature, training, schema, pipeline versions with rollback support.
 */
import crypto from "node:crypto";
import prisma from "../../src/lib/prisma";
import { ANALYTICS_CONFIG } from "../config";

export type VersionType = "dataset" | "feature" | "training" | "schema" | "pipeline";

export async function createVersion(
  versionType: VersionType,
  metadata?: Record<string, unknown>,
): Promise<{ versionTag: string; id: string }> {
  const versionTag = `${versionType}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const checksum = crypto.createHash("sha256").update(JSON.stringify(metadata ?? {})).digest("hex").slice(0, 16);

  const row = await prisma.dataVersion.create({
    data: {
      versionType,
      versionTag,
      schemaVersion: metadata?.schemaVersion as string ?? "1.0.0",
      pipelineVersion: ANALYTICS_CONFIG.pipelineVersion,
      datasetVersion: versionType === "dataset" ? versionTag : undefined,
      featureVersion: versionType === "feature" ? versionTag : undefined,
      trainingVersion: versionType === "training" ? versionTag : undefined,
      checksum,
      metadata: metadata ?? {},
      isActive: true,
    },
  });

  await prisma.dataVersion.updateMany({
    where: { versionType, isActive: true, id: { not: row.id } },
    data: { isActive: false },
  });

  return { versionTag, id: row.id };
}

export async function getActiveVersion(versionType: VersionType) {
  return prisma.dataVersion.findFirst({
    where: { versionType, isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function rollbackVersion(versionType: VersionType, targetVersionTag: string): Promise<boolean> {
  const target = await prisma.dataVersion.findUnique({
    where: { versionType_versionTag: { versionType, versionTag: targetVersionTag } },
  });
  if (!target) return false;

  await prisma.dataVersion.updateMany({ where: { versionType }, data: { isActive: false } });
  await prisma.dataVersion.update({
    where: { id: target.id },
    data: { isActive: true, rollbackOf: targetVersionTag },
  });
  return true;
}

export async function listVersions(versionType: VersionType, limit = 20) {
  return prisma.dataVersion.findMany({
    where: { versionType },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
