/**
 * Every admin router must admit an admin — not just refuse everyone else.
 *
 * `admin-governance` and `admin-ml` are mounted directly in `src/index.ts`, not inside
 * `routes/admin.ts`, and each used only `adminRbacPlugin`. Its inner auth plugin is a *named* Elysia
 * plugin, and named plugins are deduplicated: once `routes/admin.ts` had registered it, these two
 * routers never received the auth derive, `requireRole` was undefined, and admin-rbac's fail-closed
 * branch answered 401 to every caller — a signed-in super-admin included.
 *
 * Nothing was exposed, so every existing RBAC suite passed: they assert refusals, and a router that
 * refuses everyone passes every refusal assertion there is. The AI-budget console, stuck-workflow
 * recovery, workflow-draft review and the ML console were all unusable. Found in Pass 6 by logging
 * in as the demo admin and calling the endpoints.
 *
 * So this asserts the half the other suites cannot: the right principal gets in. It goes through the
 * real `app`, because the defect lives in how routers are mounted, and a router tested in isolation
 * would have passed.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `sar-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 90_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

const get = (path: string, token?: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));

/** One read per router that is mounted outside routes/admin.ts, plus admin.ts itself as a control. */
const ROUTES = [
  "/api/admin/governance/ai-budgets",
  "/api/admin/governance/workflows/stuck",
  "/api/admin/governance/workflow-drafts",
  "/api/admin/ml/readiness",
  "/api/admin/dashboard",
];

describe.serial("standalone admin routers — the right principal gets in", () => {
  for (const path of ROUTES) {
    test(`${path}: super-admin 200, customer 403, anonymous 401`, async () => {
      if (!dbOk) return;
      expect((await get(path, bearer(ctx.superAdmin))).status).toBe(200);
      expect((await get(path, bearer(ctx.customerA))).status).toBe(403);
      expect((await get(path)).status).toBe(401);
    });
  }
});
