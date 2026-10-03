import { PrismaClient } from "@prisma/client";
import { resolvePrismaDatasourceUrl } from "./database-url";

/**
 * BASE Prisma client — NO PII extension. This exists to break the dependency cycle:
 *   prisma.ts → prisma-pii-extension → encryption.service → {key-management, enterprise-audit}
 * The key-management + enterprise-audit services operate on encryption keys / audit logs (NOT user
 * PII), so they must use this un-extended client. The extended client in `prisma.ts` shares this
 * same underlying engine (one connection pool) — it just adds the PII encrypt/decrypt layer on top.
 */
/**
 * RETAINED CAST. `globalThis` has no typed slot for an application's own singleton, so reaching
 * one through it requires telling TypeScript what is there. This is the standard dev-reload
 * singleton guard: the alternative is `declare global`, which would publish `prismaBase` as a
 * global for the ENTIRE program — a wider claim than the one made here, for no safety gain.
 * Nothing crosses a trust boundary: the value is written by this module and read by this module.
 */
const globalForPrisma = globalThis as unknown as { prismaBase: PrismaClient | undefined };

/**
 * LAST-LINE TEST ISOLATION BARRIER.
 *
 * `load-env.ts` already refuses to run tests against a non-test database -- but only if it runs.
 * It is wired as a `[test] preload` in `apps/backend/bunfig.toml`, so it is skipped entirely when
 * `bun test` is invoked from a different working directory (the repo root, for instance). The
 * preload's own comment warns that a single test file which forgets `import "../load-env"` can
 * poison the shared client; a missing preload does the same thing to every file at once.
 *
 * Observed, not theorised: running the suite from the repo root loaded no `.env.test`, connected
 * to the live `homigo_db`, and wrote 141 fixture bookings into it before the handful of suites
 * carrying `refuseIfNotIsolatedTestDb` noticed. The other ~115 files have no such guard.
 *
 * `NODE_ENV` is set to "test" by Bun itself for `bun test`, independently of any preload, env file
 * or working directory -- which makes it the one signal available at the moment the client is
 * constructed. Checking here means the process cannot obtain a production client under test, no
 * matter how the suite was invoked.
 */
function assertTestDatabaseIsolation(url: string): void {
  if (process.env.NODE_ENV !== "test") return;
  if (!url) return;
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, "").split("?")[0] ?? "";
  } catch {
    return;
  }
  if (!name) return;
  const isolated = /test/i.test(name) || name === "homigo_p39";
  if (isolated) return;
  throw new Error(
    `REFUSING TO CONSTRUCT A PRISMA CLIENT: NODE_ENV=test but DATABASE_URL points at "${name}", ` +
      "which is not an isolated test database. This almost always means `bun test` was run from " +
      "the wrong directory, so apps/backend/bunfig.toml's [test] preload (./src/load-env.ts) never " +
      "ran and .env.test was never loaded. Run the suite from apps/backend.",
  );
}

function baseDatasourceUrl(): string {
  const url = resolvePrismaDatasourceUrl();
  assertTestDatabaseIsolation(url);
  return url;
}

function createBaseClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: baseDatasourceUrl() } },
    log:
      process.env.NODE_ENV === "development" && process.env.LOAD_TEST_MODE !== "1"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/**
 * A client with its OWN connection pool, for infrastructure that must never compete with request
 * traffic for a connection (the leader-lock anchors in distributed-scheduler.ts). Same database, same
 * test-isolation guard; only `connection_limit` / `pool_timeout` differ. No PII extension — callers
 * issue raw SQL only.
 */
export function createDedicatedPoolClient(connectionLimit: number, poolTimeoutSec: number): PrismaClient {
  const url = new URL(baseDatasourceUrl());
  url.searchParams.set("connection_limit", String(Math.max(1, Math.floor(connectionLimit))));
  url.searchParams.set("pool_timeout", String(Math.max(1, Math.floor(poolTimeoutSec))));
  return new PrismaClient({ datasources: { db: { url: url.toString() } }, log: ["error"] });
}

export const prismaBase = globalForPrisma.prismaBase ?? createBaseClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = prismaBase;
}

export default prismaBase;
