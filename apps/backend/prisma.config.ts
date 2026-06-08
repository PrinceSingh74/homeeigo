import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

/** Prisma CLI config (replaces deprecated `package.json#prisma` block). */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "bun run scripts/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
