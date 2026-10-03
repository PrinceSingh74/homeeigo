/**
 * Isolated-DB smoke check. Must stay tiny so we can tell Prisma hang from service-graph hang.
 */
import { expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";

test(
  "test DATABASE_URL points at a *test* database and answers SELECT 1",
  async () => {
    const url = process.env.DATABASE_URL ?? "";
    const dbName = url.split("/").pop()?.split("?")[0] ?? "";
    expect(dbName, url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@")).toMatch(/test/i);

    const rows = (await prisma.$queryRawUnsafe("SELECT current_database() AS db")) as Array<{ db: string }>;
    expect(rows[0]?.db).toMatch(/test/i);
  },
  { timeout: 30_000 },
);
