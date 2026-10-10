/**
 * Read-only outbox / notification counts on the isolated test DB.
 * Never prints secrets. Never writes homigo_db / staging.
 */
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { requireDeclaredTarget } from "./lib/script-target";

const FORBIDDEN = new Set(["homigo_db", "homigo_staging_db", "postgres"]);
const SOURCE = requireDeclaredTarget({ label: "phase-7-outbox-probe" });
if (FORBIDDEN.has(SOURCE.database) || SOURCE.live) {
  console.error(`[phase-7] REFUSING source database "${SOURCE.database}"`);
  process.exit(2);
}

function parseDbUrl(url: string) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL must be postgresql://user:pass@host:port/db");
  return { user: decodeURIComponent(m[1]!), password: decodeURIComponent(m[2]!), host: m[3]!, port: m[4]!, db: m[5]! };
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stderr: string; stdout: string }>((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err), stdout: "" }));
  });
}

const creds = parseDbUrl(process.env.DATABASE_URL ?? "");
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "homigo-postgres";

async function psql(sql: string) {
  const r = await run("docker", [
    "exec",
    "-e",
    `PGPASSWORD=${creds.password}`,
    CONTAINER,
    "psql",
    "-U",
    creds.user,
    "-d",
    creds.db,
    "-t",
    "-A",
    "-c",
    sql,
  ]);
  if (r.code !== 0) throw new Error(r.stderr || `psql failed: ${sql}`);
  return r.stdout.trim();
}

function rows(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("|").map((s) => s.trim()));
}

const outbox = Object.fromEntries(rows(await psql(`SELECT status::text, COUNT(*)::text FROM event_outbox GROUP BY status ORDER BY status`)));
const receipts = Number((await psql(`SELECT COUNT(*) FROM event_consumer_receipts`)) || "0");
const deliveriesByChannel = Object.fromEntries(
  rows(await psql(`SELECT channel::text, COUNT(*)::text FROM notification_deliveries GROUP BY channel ORDER BY 1`)),
);
const deliveriesByStatus = Object.fromEntries(
  rows(await psql(`SELECT status::text, COUNT(*)::text FROM notification_deliveries GROUP BY status ORDER BY 1`)),
);
const goldNotifs = Number(
  (await psql(
    `SELECT COUNT(*) FROM notifications WHERE booking_id = 'cmv20qxxz00b4tzp8muuuj8d6' OR reference_id = 'cmv20qxxz00b4tzp8muuuj8d6'`,
  )) || "0",
);
const pendingTypes = Object.fromEntries(
  rows(await psql(`SELECT event_type, COUNT(*)::text FROM event_outbox WHERE status = 'PENDING' GROUP BY event_type ORDER BY 2 DESC LIMIT 12`)),
);

const evidence = {
  phase: 7,
  database: creds.db,
  hostPort: `${creds.host}:${creds.port}`,
  outboxByStatus: outbox,
  consumerReceipts: receipts,
  deliveriesByChannel,
  deliveriesByStatus,
  goldBookingNotifications: goldNotifs,
  pendingEventTypes: pendingTypes,
  isolatedConsumersNote:
    "Isolated stack redis=disabled; outbox processor may still drain in-process. Counts are observational, not a live SMS/email send.",
  finishedAt: new Date().toISOString(),
};

writeFileSync("D:/homigo/docs/phase-7-outbox-evidence.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
