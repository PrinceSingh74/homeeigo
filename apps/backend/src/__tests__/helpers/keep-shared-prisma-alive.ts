/**
 * Combined `bun test` shares one Prisma query engine across every file.
 *
 * Calling `$disconnect()` on that singleton (typical `afterAll` cleanup copied from
 * standalone scripts) leaves later files with "Engine is not yet connected" or
 * "Response from the Engine was empty". Bun does not restore the engine on a
 * subsequent `$connect()` of the same client.
 *
 * Tests that must prove disconnect/reconnect should construct a disposable
 * `new PrismaClient()` — never the process singleton.
 *
 * This module is bunfig `[test].preload`, so it runs after `load-env.ts` and
 * before any test file imports Prisma.
 */
import { prismaBase } from "../../lib/prisma-base";
import prisma from "../../lib/prisma";

function retainEngine(client: { $disconnect: () => Promise<void> }): void {
  try {
    client.$disconnect = async () => undefined;
  } catch {
    /* Prisma may freeze the method; afterAll call sites were also removed. */
  }
}

retainEngine(prismaBase);
retainEngine(prisma);
