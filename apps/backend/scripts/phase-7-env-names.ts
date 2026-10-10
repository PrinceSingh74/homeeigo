/** Prints database names only. Never prints connection strings or secrets. */
import { readFileSync, existsSync } from "node:fs";

function dbName(file: string): string {
  if (!existsSync(file)) return "MISSING";
  const t = readFileSync(file, "utf8");
  const m = t.match(/^DATABASE_URL=(.*)$/m);
  if (!m) return "NO_DATABASE_URL";
  const raw = m[1]!.trim().replace(/^["']|["']$/g, "");
  try {
    const u = new URL(raw.replace(/^postgres(ql)?:/i, "http:"));
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "").split("?")[0] || "EMPTY"}`;
  } catch {
    return "UNPARSEABLE";
  }
}

console.log(JSON.stringify({
  envTest: dbName("D:/homigo/apps/backend/.env.test"),
  env: dbName("D:/homigo/apps/backend/.env"),
  envStaging: dbName("D:/homigo/apps/backend/.env.staging"),
}, null, 2));
