import { PrismaClient } from "@prisma/client";
import { resolvePrismaDatasourceUrl } from "./database-url";

/**
 * BASE Prisma client — NO PII extension. This exists to break the dependency cycle:
 *   prisma.ts → prisma-pii-extension → encryption.service → {key-management, enterprise-audit}
 * The key-management + enterprise-audit services operate on encryption keys / audit logs (NOT user
 * PII), so they must use this un-extended client. The extended client in `prisma.ts` shares this
 * same underlying engine (one connection pool) — it just adds the PII encrypt/decrypt layer on top.
 */
const globalForPrisma = globalThis as unknown as { prismaBase: PrismaClient | undefined };

function createBaseClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: resolvePrismaDatasourceUrl() } },
    log:
      process.env.NODE_ENV === "development" && process.env.LOAD_TEST_MODE !== "1"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prismaBase = globalForPrisma.prismaBase ?? createBaseClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = prismaBase;
}

export default prismaBase;
