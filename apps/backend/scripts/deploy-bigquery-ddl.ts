#!/usr/bin/env bun
/**
 * Deploy all Phase 1 BigQuery DDL in order.
 *   bun run --env-file=.env scripts/deploy-bigquery-ddl.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BigQuery } from "@google-cloud/bigquery";

const P = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const LOC = process.env.BQ_LOCATION ?? "asia-south1";
const bqDir = join(import.meta.dir, "../analytics/bigquery");
const bq = new BigQuery({ projectId: P });

const FILES = readdirSync(bqDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

async function runFile(file: string): Promise<void> {
  const sql = readFileSync(join(bqDir, file), "utf8").trim();
  if (!sql) return;
  console.log(`\n--- ${file} ---`);

  // Split on CREATE OR REPLACE MODEL blocks so views/tables always deploy even if models lack data
  const parts = sql.split(/(?=CREATE OR REPLACE MODEL)/i);
  for (const part of parts) {
    const chunk = part.trim();
    if (!chunk) continue;
    const isModel = /^CREATE OR REPLACE MODEL/i.test(chunk);
    try {
      await bq.query({ query: chunk, location: LOC });
      console.log(`  ✅ ${isModel ? "model" : "ddl"} applied`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Already Exists") || msg.includes("already exists")) {
        console.log(`  ⏭️  already exists`);
      } else if (isModel && (msg.includes("doesn't contain any rows") || msg.includes("Not found: Table"))) {
        console.log(`  ⏭️  model skipped (insufficient training data — run train-models.ts after ETL)`);
      } else {
        throw err;
      }
    }
  }
}

async function verify(): Promise<void> {
  const datasets = [
    "homigo_analytics",
    "homigo_analytics_raw",
    "homigo_analytics_validated",
    "homigo_analytics_feature",
    "homigo_analytics_analytics",
  ];
  console.log("\n=== Dataset verification ===");
  for (const ds of datasets) {
    const [tables] = await bq.dataset(ds).getTables();
    console.log(`  ${ds}: ${tables.length} tables`);
  }

  const [cols] = await bq.query({
    query: `SELECT column_name FROM \`${P}.homigo_analytics.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'fact_bookings' AND column_name = 'updated_at'`,
    location: LOC,
  });
  if (!cols.length) throw new Error("fact_bookings.updated_at column missing after alignment");
  console.log("  fact_bookings.updated_at: OK");
}

const SKIP_FILES = new Set(["03_models.sql"]); // models trained after ETL via train-models.ts

async function main(): Promise<void> {
  console.log(`Deploying BigQuery DDL to ${P} (${LOC})\n`);
  for (const file of FILES) {
    if (SKIP_FILES.has(file)) {
      console.log(`\n--- ${file} --- ⏭️  skipped (train via train-models.ts after ETL)`);
      continue;
    }
    await runFile(file);
  }
  await verify();
  console.log("\nBigQuery DDL deployment complete.");
}

main().catch((e) => { console.error("DDL deploy failed:", e); process.exit(1); });
