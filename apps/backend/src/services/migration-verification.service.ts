import crypto from "crypto";
import fs from "fs";
import path from "path";
import { MigrationVerificationStatus } from "@prisma/client";
import prisma from "../lib/prisma";

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
};

export class MigrationVerificationService {
  async runVerification(): Promise<{
    runId: string;
    status: MigrationVerificationStatus;
    report: Record<string, unknown>;
  }> {
    const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
    const diskMigrations = fs
      .readdirSync(migrationsDir)
      .filter((name) => fs.statSync(path.join(migrationsDir, name)).isDirectory())
      .filter((name) => fs.existsSync(path.join(migrationsDir, name, "migration.sql")))
      .sort();

    const appliedRows = await prisma.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at, logs
      FROM "_prisma_migrations"
      ORDER BY finished_at ASC NULLS LAST
    `;

    const appliedNames = new Set(appliedRows.map((r) => r.migration_name));
    const pending = diskMigrations.filter((m) => !appliedNames.has(m));
    const failed = appliedRows.filter((r) => r.rolled_back_at != null);
    const appliedCount = appliedRows.filter((r) => r.finished_at && !r.rolled_back_at).length;

    const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    const schemaChecksum = crypto
      .createHash("sha256")
      .update(fs.readFileSync(schemaPath))
      .digest("hex");

    const lastRun = await prisma.migrationVerificationRun.findFirst({
      orderBy: { createdAt: "desc" },
    });
    const driftDetected = lastRun != null && lastRun.schemaChecksum !== schemaChecksum && pending.length > 0;

    const duplicateNames = diskMigrations.filter(
      (m, i, arr) => arr.indexOf(m) !== i,
    );
    const rollbackRisk = failed.length > 0 || pending.some((p) => {
      const idx = diskMigrations.indexOf(p);
      return diskMigrations.slice(idx + 1).some((later) => appliedNames.has(later));
    });

    const dependencyGraph = diskMigrations.map((m, i) => ({
      migration: m,
      dependsOn: i > 0 ? diskMigrations[i - 1] : null,
      applied: appliedNames.has(m),
    }));

    const issues: string[] = [];
    if (pending.length) issues.push(`${pending.length} pending migration(s)`);
    if (failed.length) issues.push(`${failed.length} failed/rolled-back migration(s)`);
    if (driftDetected) issues.push("Schema checksum drift detected");
    if (rollbackRisk) issues.push("Rollback risk: out-of-order migration state");
    if (duplicateNames.length) issues.push("Duplicate migration folders detected");

    const status =
      issues.length === 0 ? MigrationVerificationStatus.PASS : MigrationVerificationStatus.FAIL;

    const report = {
      status,
      appliedCount,
      pendingCount: pending.length,
      failedCount: failed.length,
      driftDetected,
      rollbackRisk,
      schemaChecksum,
      pending,
      failed: failed.map((f) => f.migration_name),
      dependencyGraph,
      diskMigrationCount: diskMigrations.length,
      issues,
    };

    const run = await prisma.migrationVerificationRun.create({
      data: {
        status,
        appliedCount,
        pendingCount: pending.length,
        failedCount: failed.length,
        driftDetected,
        rollbackRisk,
        schemaChecksum,
        report: JSON.stringify(report),
      },
    });

    return { runId: run.id, status, report };
  }

  async getLatestReport() {
    const latest = await prisma.migrationVerificationRun.findFirst({
      orderBy: { createdAt: "desc" },
    });
    if (!latest) return null;
    return {
      ...latest,
      report: JSON.parse(latest.report) as Record<string, unknown>,
    };
  }

  async listRuns(limit = 20) {
    return prisma.migrationVerificationRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

export const migrationVerificationService = new MigrationVerificationService();
