#!/usr/bin/env bun
/**
 * Phase 4 Enterprise AI Brain — Performance Benchmark
 *   bun run --env-file=.env scripts/phase-4-benchmark.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { invokeAiGateway } from "../src/ai";
import { buildEnterpriseContext } from "../src/ai-brain/context/enterprise-context-builder";
import { retrieveMemories } from "../src/ai-brain/memory/memory-engine";
import { composePrompt } from "../src/ai-brain/prompts/prompt-intelligence";
import { getRolePermissions } from "../src/ai/security/authorization";
import prisma from "../src/lib/prisma";

process.env.AI_GATEWAY_DRY_RUN = "true";
process.env.AI_BRAIN_ENABLED = "true";
process.env.AI_RATE_LIMIT_BYPASS = "true";

async function getBenchUserId(): Promise<string> {
  const u = await prisma.user.findFirst({
    where: { firstName: "Phase4", lastName: "Cert" },
    select: { id: true },
  });
  if (u) return u.id;
  const created = await prisma.user.create({
    data: {
      email: `bench-${Date.now()}@homigo.internal`,
      firstName: "Phase4",
      lastName: "Cert",
      password: "bench-not-used",
      role: "CUSTOMER",
    },
    select: { id: true },
  });
  return created.id;
}

type BenchResult = {
  label: string;
  count: number;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
};

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function benchmark(label: string, count: number, fn: () => Promise<void>): Promise<BenchResult> {
  const latencies: number[] = [];
  const t0 = Date.now();

  for (let i = 0; i < count; i++) {
    const start = Date.now();
    await fn();
    latencies.push(Date.now() - start);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const totalMs = Date.now() - t0;

  return {
    label,
    count,
    totalMs,
    avgMs: Math.round(totalMs / count),
    p95Ms: percentile(sorted, 95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

async function main(): Promise<void> {
  console.log("HOMIGO Phase 4 — Performance Benchmark\n");

  const benchUserId = await getBenchUserId();
  const actor = { actorId: benchUserId, actorRole: "CUSTOMER" as const, ipAddress: "127.0.0.1" };
  const message = "What home services do you offer in Gurgaon?";

  const results: BenchResult[] = [];

  for (const count of [100, 500, 1000]) {
    results.push(await benchmark(`gateway_${count}`, count, async () => {
      await invokeAiGateway({
        actor,
        endpoint: "customer",
        input: { message },
      });
    }));
    console.log(`Gateway ${count}: avg=${results.at(-1)!.avgMs}ms p95=${results.at(-1)!.p95Ms}ms`);
  }

  results.push(await benchmark("context_build_100", 100, async () => {
    await buildEnterpriseContext({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      message,
    });
  }));
  console.log(`Context build: avg=${results.at(-1)!.avgMs}ms`);

  results.push(await benchmark("memory_recall_100", 100, async () => {
    await retrieveMemories({ ownerId: actor.actorId, query: "services", limit: 5 });
  }));
  console.log(`Memory recall: avg=${results.at(-1)!.avgMs}ms`);

  const ctx = await buildEnterpriseContext({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    message,
  });
  results.push(await benchmark("prompt_compose_100", 100, async () => {
    await composePrompt({
      role: actor.actorRole,
      context: ctx,
      message,
      permissions: getRolePermissions(actor.actorRole),
      actorId: actor.actorId,
      promptId: "customer.support.v1",
    });
  }));
  console.log(`Prompt compose: avg=${results.at(-1)!.avgMs}ms`);

  const mem = process.memoryUsage();
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    benchmarks: results,
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    },
    thresholds: {
      gatewayAvgMsTarget: 500,
      contextAvgMsTarget: 200,
      memoryAvgMsTarget: 50,
      promptAvgMsTarget: 100,
    },
  };

  const outDir = path.join(process.cwd(), "docs", "phase4-evidence");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "benchmark-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\nBenchmark report written to ${outPath}`);
  console.log(`Memory: heap=${report.memory.heapUsedMb}MB rss=${report.memory.rssMb}MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
