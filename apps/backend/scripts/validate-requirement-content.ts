/**
 * Validate the FINAL Phase 06 content (no database unless --live-universe): contradictions,
 * duplicates, copy↔data, leakage, commercial and safety rules, coverage of the live service universe,
 * readiness matrix and quality scores.
 *
 *   bun run scripts/validate-requirement-content.ts [--json out.json]
 *   bun --env-file=.env run scripts/validate-requirement-content.ts --live-universe   # read-only: coverage vs the DB
 */
import { writeFileSync } from "node:fs";
import { validateContent } from "./lib/requirement-content-validator";
import { CATALOGUE, CONTENT, CONTENT_VERSION } from "./data/phase-06-requirement-content-final";

const args = process.argv.slice(2);
const jsonOut = args[args.indexOf("--json") + 1];
let liveServices: string[] | undefined;
if (args.includes("--live-universe")) {
  const { default: prisma } = await import("../src/lib/prisma");
  const rows = await prisma.service.findMany({ where: { dataOrigin: null }, select: { slug: true } });
  liveServices = rows.map((r) => r.slug);
  await prisma.$disconnect();
}
const report = validateContent({ version: CONTENT_VERSION, catalogue: CATALOGUE, content: CONTENT, liveServices });
for (const f of report.findings) console.log(`${f.severity}  ${f.rule}  ${f.message}`);
console.log(`\n[content-validate] ${CONTENT_VERSION}: ${report.errors} error(s), ${report.warnings} warning(s) · ${Object.keys(CONTENT).length} services · ${report.catalogue.total} items ${JSON.stringify(report.catalogue.byKind)} · ${report.assignments} assignments${liveServices ? ` · live universe ${liveServices.length}` : ""}`);
const byStatus = report.readiness.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
console.log(`[content-validate] readiness: ${JSON.stringify(byStatus)} · blocking: ${report.readiness.filter((r) => r.blocking.length).map((r) => r.service).join(", ") || "none"} · min score ${Math.min(...report.readiness.map((r) => r.score))}`);
if (jsonOut && args.includes("--json")) { writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n"); console.log(`[content-validate] report → ${jsonOut}`); }
process.exit(report.errors ? 1 : 0);
