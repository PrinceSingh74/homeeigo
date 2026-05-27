/**
 * One-time local DB setup: copy .env, start Docker Postgres, migrate, seed.
 * Run: bun run db:setup
 */
import { existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error("Missing .env.example");
    process.exit(1);
  }
  copyFileSync(examplePath, envPath);
  console.log("Created apps/backend/.env from .env.example");
} else {
  console.log("Using existing apps/backend/.env");
}

const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

async function main() {
if (hasDocker) {
  console.log("Starting PostgreSQL (Docker)…");
  const up = spawnSync("docker", ["compose", "up", "-d"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (up.status !== 0) {
    console.warn(
      "Docker compose failed. If PostgreSQL is already installed, set DATABASE_URL in .env to match your local credentials.",
    );
  } else {
    console.log("Waiting for Postgres to be ready…");
    await new Promise((r) => setTimeout(r, 5000));
  }
} else {
  console.log(
    "Docker not found. Ensure PostgreSQL is running and DATABASE_URL in .env is correct.",
  );
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Load .env for child processes
const { config } = await import("dotenv");
config({ path: envPath });

run("npx", ["prisma", "migrate", "dev", "--name", "init"]);
run("bun", ["run", "db:seed"]);

console.log("\nDone. Demo password: Homigo@123");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
