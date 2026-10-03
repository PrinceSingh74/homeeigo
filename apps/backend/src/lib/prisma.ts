import type { PrismaClient } from "@prisma/client";
import { prismaBase } from "./prisma-base";
import { registerDatabaseMetricsProvider } from "./metrics";
import { prismaPiiExtension } from "./prisma-pii-extension";

/**
 * RETAINED CAST. Same dev-reload singleton guard as prisma-base.ts — `globalThis` has no typed
 * slot for an application's own client, and the value is written and read only by this module.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * RETAINED CAST, deliberately.
 *
 * `$extends` returns Prisma's *extended* client type, which is structurally distinct from
 * `PrismaClient` even though it exposes the same model delegates. The runtime object is the real
 * extended client — the PII encrypt/decrypt layer is applied on every call regardless of how the
 * type is spelled — so nothing about behaviour is being asserted away here.
 *
 * The type-accurate alternative is to export `ReturnType<typeof createPrismaClient>` and retype
 * every consumer against it. That is not a local change: it re-types several hundred call sites,
 * and Prisma's extended client type is heavy enough that it is a plausible source of the
 * instantiation-depth failures already seen in this codebase (TS2589 in index.ts). The narrowing
 * to `PrismaClient` loses no delegate and no field.
 *
 * Removable when Prisma's extended client is assignable to `PrismaClient`, or if the codebase
 * adopts a single exported client type.
 */
function createPrismaClient(): PrismaClient {
  // Extend the shared base client (same connection pool) with the PII encrypt/decrypt layer.
  return prismaBase.$extends(prismaPiiExtension()) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Database reachability for `/metrics`, registered the same way `lib/redis` registers its own.
 *
 * `SELECT 1` and nothing more: this runs on every scrape, so it must cost nothing and must not
 * depend on any table existing. Any throw is reported as down, because a probe that fails IS the
 * outage — and a gauge that disappears on error would make `DatabaseDown` silently absent at
 * precisely the moment it is needed.
 */
registerDatabaseMetricsProvider(async () => {
  try {
    await prismaBase.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
});

export default prisma;
