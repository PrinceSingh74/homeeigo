/**
 * Detects client-owned copies of service-domain business rules.
 * Compatibility adapters (taxonomy maps, onboarding fallback) are allow-listed.
 *
 *   bun run scripts/audit-service-domain-duplicates.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repo = join(import.meta.dir, "../../..");

const SCANS: Array<{ id: string; needle: RegExp; allow: RegExp[] }> = [
  {
    id: "calculateTotal",
    needle: /function\s+calculateTotal|const\s+calculateTotal\s*=/,
    allow: [/homigo-mobile[\\/]src[\\/]lib[\\/]booking\.ts/],
  },
  {
    id: "fabricated_rating_4_8",
    needle: /rating\s*[:=]\s*["']?4\.8/,
    allow: [
      /[\\/]__tests__[\\/]/,
      /[\\/]tests[\\/]/,
      /apps[\\/]web[\\/]src[\\/]lib[\\/]services\.ts$/,
      /apps[\\/]web[\\/]src[\\/]lib[\\/]services-page-data\.ts$/,
      /homigo-mobile[\\/]src[\\/]constants[\\/]servicesData\.ts$/,
    ],
  },
];

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === "dist" || name === "dist-e2e" || name === "__artifacts__") {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

const roots = [
  join(repo, "apps/web/src"),
  join(repo, "apps/admin-panel/src"),
  join(repo, "apps/partner-web/src"),
  join(repo, "homigo-mobile/src"),
  join(repo, "homigo-mobile/app"),
  join(repo, "homigo-partner-mobile/src"),
];

const files = roots.flatMap((r) => walk(r));
const hits: string[] = [];

for (const scan of SCANS) {
  for (const file of files) {
    const rel = relative(repo, file).replace(/\\/g, "/");
    if (scan.allow.some((re) => re.test(rel))) continue;
    const text = readFileSync(file, "utf8");
    if (scan.needle.test(text)) hits.push(`${scan.id}\t${rel}`);
  }
}

if (hits.length) {
  process.stdout.write("FAIL duplicate / fabricated business data:\n" + hits.join("\n") + "\n");
  process.exit(1);
}

process.stdout.write("PASS no client calculateTotal and no remaining rating=4.8 assignments in scanned UI.\n");
