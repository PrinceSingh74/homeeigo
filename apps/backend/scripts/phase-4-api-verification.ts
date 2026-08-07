#!/usr/bin/env bun
/**
 * Phase 4 HTTP API verification — in-process Elysia handle (no external server).
 */
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { smokeAppReq } from "./smoke-lib";

type ApiCheck = { route: string; method: string; passed: boolean; status: number; detail: string };
const checks: ApiCheck[] = [];

async function api(
  method: string,
  route: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await smokeAppReq(route, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: r.body };
}

async function loginAdmin(): Promise<string> {
  const r = await smokeAppReq("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@homigo.demo",
      password: "Homigo@123",
      setAuthCookies: false,
    }),
  });
  const token = (r.body.data as Record<string, unknown> | undefined)?.accessToken as string | undefined;
  if (!token) throw new Error(`Admin login failed: status=${r.status}`);
  return token;
}

function record(method: string, route: string, passed: boolean, status: number, detail: string): void {
  checks.push({ method, route, passed, status, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${method} ${route} → ${status} ${detail}`);
}

async function main(): Promise<void> {
  console.log("Phase 4 API Verification\n");
  const token = await loginAdmin();

  const tests: Array<{
    method: string;
    route: string;
    body?: Record<string, unknown>;
    expectStatus?: number;
    validate?: (body: Record<string, unknown>) => boolean;
  }> = [
    { method: "GET", route: "/api/ai/memory", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/memory/stats", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/prompts", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/prompt-versions/customer.support.v1", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/prompt-versions/customer.support.v1/diff/1", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/context/cache", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/context/history", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/timeline?limit=5", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/conversations?limit=5", expectStatus: 200, validate: (b) => b.success === true },
    { method: "GET", route: "/api/ai/conversations/recall?q=services", expectStatus: 200, validate: (b) => b.success === true },
    {
      method: "POST",
      route: "/api/ai/context",
      body: { message: "API verification context build" },
      expectStatus: 200,
      validate: (b) => b.success === true && Boolean((b.data as Record<string, unknown>)?.systemContext),
    },
    {
      method: "POST",
      route: "/api/ai/memory",
      body: {
        memoryKey: `api:verify:${Date.now()}`,
        memoryType: "SESSION",
        content: { api: true },
        summary: "API verify memory",
      },
      expectStatus: 200,
      validate: (b) => b.success === true,
    },
  ];

  let memoryId = "";
  for (const t of tests) {
    const r = await api(t.method, t.route, token, t.body);
    const ok = r.status === (t.expectStatus ?? 200) && (t.validate ? t.validate(r.body) : true);
    record(t.method, t.route, ok, r.status, ok ? "ok" : JSON.stringify(r.body).slice(0, 80));
    if (t.route === "/api/ai/memory" && t.method === "POST" && r.body.data) {
      memoryId = (r.body.data as Record<string, unknown>).id as string;
    }
  }

  if (memoryId) {
    const compress = await api("POST", `/api/ai/memory/${memoryId}/compress`, token, { summary: "API compressed" });
    record("POST", `/api/ai/memory/${memoryId}/compress`, compress.status === 200, compress.status, "compress");
  }

  const reject = await api("POST", "/api/ai/prompt-versions/reject", token, { promptId: "customer.support.v1" });
  record("POST", "/api/ai/prompt-versions/reject", reject.status === 200, reject.status, "reject");
  const approve = await api("POST", "/api/ai/prompt-versions/approve", token, { promptId: "customer.support.v1", version: 1 });
  record("POST", "/api/ai/prompt-versions/approve", approve.status === 200, approve.status, "approve-restore");

  const failed = checks.filter((c) => !c.passed);
  const outDir = path.join(process.cwd(), "docs", "phase4-evidence");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "api-verification.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), checks, passed: checks.length - failed.length, failed: failed.length }, null, 2),
  );

  console.log(`\nAPI verification: ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
