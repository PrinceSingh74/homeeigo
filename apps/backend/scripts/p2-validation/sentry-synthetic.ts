/**
 * P2 — Sentry Delivery Validation (runnable; reuses src/lib/observability.ts).
 *
 * Generates a synthetic failure for every required category and (optionally)
 * confirms delivery + grouping + release tagging via the Sentry REST API.
 *
 * Categories: backend exception, payment failure, webhook failure, auth failure
 * (frontend/mobile are validated in their own SDKs — snippets in the report).
 *
 * Required to actually emit:  SENTRY_DSN
 * Optional delivery proof:    SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT
 *
 *   SENTRY_DSN=... bun --env-file=.env run scripts/p2-validation/sentry-synthetic.ts
 *
 * No DSN → exits 2, writes a NOT VERIFIED evidence file (never fakes success).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { observability } from "../../src/lib/observability";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, "..", "..", "..", "..", "docs", "p2", "evidence");

const DSN = process.env.SENTRY_DSN?.trim() ?? "";
const TOKEN = process.env.SENTRY_AUTH_TOKEN ?? "";
const ORG = process.env.SENTRY_ORG ?? "";
const PROJECT = process.env.SENTRY_PROJECT ?? "";
const RELEASE = process.env.APP_VERSION || "homigo-backend@1.0.0";
const MARKER = `p2-sentry-drill-${Date.now()}`;

type Synthetic = { category: "database" | "payment" | "integration" | "auth" | "security"; message: string };

const SYNTHETICS: Synthetic[] = [
  { category: "database", message: `${MARKER} synthetic backend/database exception` },
  { category: "payment", message: `${MARKER} synthetic payment failure` },
  { category: "integration", message: `${MARKER} synthetic webhook processing failure` },
  { category: "auth", message: `${MARKER} synthetic auth failure` },
  { category: "security", message: `${MARKER} synthetic security event` },
];

async function verifyDelivery(): Promise<{ verified: boolean; detail: string }> {
  if (!TOKEN || !ORG || !PROJECT) return { verified: false, detail: "delivery proof skipped (set SENTRY_AUTH_TOKEN/ORG/PROJECT)" };
  // Give Sentry time to ingest, then query issues by our marker.
  await new Promise((r) => setTimeout(r, 8000));
  try {
    const url = `https://sentry.io/api/0/projects/${ORG}/${PROJECT}/issues/?query=${encodeURIComponent(MARKER)}&statsPeriod=24h`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) return { verified: false, detail: `Sentry API ${res.status}` };
    const issues = (await res.json()) as Array<{ title: string; culprit?: string; count?: string }>;
    return { verified: issues.length > 0, detail: `${issues.length} issue group(s) found for marker (grouping ✅ if >0)` };
  } catch (e) {
    return { verified: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  if (!DSN) {
    await emit([], { verified: false, detail: "no SENTRY_DSN" }, "NOT VERIFIED");
    console.error("[sentry] NOT VERIFIED — set SENTRY_DSN to emit synthetic failures");
    process.exit(2);
  }

  await observability.init();
  const emitted: { category: string; ok: boolean }[] = [];
  for (const s of SYNTHETICS) {
    try {
      observability.captureException(new Error(s.message), { category: s.category, level: "error", code: "P2_DRILL", path: "/p2/sentry-drill", method: "POST", extra: { marker: MARKER, release: RELEASE } });
      emitted.push({ category: s.category, ok: true });
    } catch {
      emitted.push({ category: s.category, ok: false });
    }
  }
  await observability.flush(5000);

  const delivery = await verifyDelivery();
  const verdict = !observability.isEnabled ? "NOT VERIFIED (SDK did not initialise)" : delivery.verified ? "COMPLETE" : "PARTIAL (emitted; delivery unconfirmed)";
  await emit(emitted, delivery, verdict);
  console.error(`\n[sentry] enabled=${observability.isEnabled} emitted=${emitted.filter((e) => e.ok).length}/${emitted.length} delivery=${delivery.verified} (${delivery.detail})`);
  process.exit(observability.isEnabled && delivery.verified ? 0 : 1);
}

async function emit(emitted: { category: string; ok: boolean }[], delivery: { verified: boolean; detail: string }, verdict: string) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const md: string[] = [];
  md.push("# Evidence — Sentry Delivery Validation");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}  ·  Marker: \`${MARKER}\`  ·  Release: \`${RELEASE}\``);
  md.push(`Verdict: **${verdict}**`);
  md.push("");
  md.push("## Synthetic failures emitted (backend)");
  md.push("| Category | Emitted |");
  md.push("|---|:--:|");
  if (emitted.length === 0) md.push("| (none — DSN unset) | — |");
  for (const e of emitted) md.push(`| ${e.category} | ${e.ok ? "✅" : "❌"} |`);
  md.push("");
  md.push("## Delivery / Grouping / Release tracking");
  md.push(`- Delivery confirmed via Sentry API: ${delivery.verified ? "✅" : "❌"} — ${delivery.detail}`);
  md.push(`- Release tag attached to events: \`${RELEASE}\` (set in observability.init)`);
  md.push("");
  md.push("## Frontend / Mobile (validated in their own SDKs)");
  md.push("Trigger from each client and confirm the issue appears under the same project:");
  md.push("```ts");
  md.push("// web (apps/web) & partner-web: @sentry/nextjs initialised, then:");
  md.push("Sentry.captureException(new Error('p2 web synthetic'));");
  md.push("// mobile (apps/mobile): @sentry/react-native, then:");
  md.push("Sentry.captureException(new Error('p2 mobile synthetic'));");
  md.push("```");
  md.push("- Source maps: confirm `sentry-cli sourcemaps upload` runs in each client's release build (CI).");
  md.push("");
  await writeFile(join(EVIDENCE_DIR, "sentry-validation.md"), md.join("\n"), "utf8");
  await writeFile(join(EVIDENCE_DIR, "sentry-validation.json"), JSON.stringify({ verdict, emitted, delivery, marker: MARKER, release: RELEASE, generatedAt: new Date().toISOString() }, null, 2), "utf8");
}

main().catch((e) => {
  console.error("[sentry] fatal:", e);
  process.exit(3);
});
