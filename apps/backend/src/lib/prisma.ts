import type { PrismaClient } from "@prisma/client";
import { prismaBase } from "./prisma-base";
import { prismaPiiExtension } from "./prisma-pii-extension";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // Extend the shared base client (same connection pool) with the PII encrypt/decrypt layer.
  return prismaBase.$extends(prismaPiiExtension()) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
