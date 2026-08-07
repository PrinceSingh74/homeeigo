#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BigQuery } from "@google-cloud/bigquery";

const P = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const LOC = process.env.BQ_LOCATION ?? "asia-south1";
const bq = new BigQuery({ projectId: P });
const sql = readFileSync(join(import.meta.dir, "../analytics/bigquery/10_phase2_eta_intelligence.sql"), "utf8");
await bq.query({ query: sql, location: LOC });
console.log("Phase 2 BQ DDL applied OK");
