/**
 * OP-4 — evidence report for every dispatchable provider whose provenance is still UNKNOWN,
 * plus the two customer accounts behind the OP-3 bookings. READ-ONLY on business tables
 * (the e-mail resolver records DATA_DECRYPTED audit rows, which is the canonical PII-access record).
 *
 * Run from apps/backend:  bun run scripts/op4-unclassified-providers-report.ts
 */
import { PrismaClient } from "@prisma/client";
import { resolveUserEmails } from "./lib/resolve-user-emails";
import { classifyUserEmail } from "../src/lib/data-provenance";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();
const OUT_MD = "D:/homigo/docs/operations/evidence/phase10-11/op4-unclassified-providers.md";
const OUT_JSON = "C:/Users/KAPIIS~1/AppData/Local/Temp/claude/d--homigo/ca2823eb-3824-4118-8dc1-b8dd30fa2d41/scratchpad/op4-report.json";
const OP3_CUSTOMERS = ["cmq9h68mp0008tz8so7py2429", "cmqbzopsk004jtzs8k3e08ihx"];

type Row = {
  provider_id: string; user_id: string; business_name: string | null; first_name: string; last_name: string;
  user_created: Date; provider_created: Date; lifecycle_state: string; is_verified: boolean; is_approved: boolean;
  background_check_status: string; is_online: boolean; last_heartbeat: Date | null; city: string | null;
  total_bookings: number; completed: number; business_customer_bookings: number; nonbusiness_customer_bookings: number;
  fixture_service_bookings: number; last_booking: Date | null; first_booking: Date | null; services_offered: number; fixture_services_offered: number;
  is_phone_verified: boolean; is_email_verified: boolean;
};

function shape(email: string | null): string {
  if (!email) return "(no e-mail)";
  const [local, domain] = email.split("@");
  const l = local ?? "";
  const kind = /^p[0-9a-f]{16,}$/i.test(l) ? "phone-placeholder" : /(test|fixture|adv|cert|seed|demo|e2e|qa|fake|dummy)/i.test(l) ? "test-word" : /\d{4,}/.test(l) ? "digits" : "name-like";
  return `${l.slice(0, 2)}…(${l.length}) @${domain} [${kind}]`;
}

async function main() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.id AS provider_id, u.id AS user_id, p.business_name, u.first_name, u.last_name,
           u.created_at AS user_created, p.created_at AS provider_created, p.lifecycle_state::text, p.is_verified, p.is_approved,
           p.background_check_status::text, p.is_online, pp.last_heartbeat_at AS last_heartbeat, p.city,
           u.is_phone_verified, u.is_email_verified,
           (SELECT count(*)::int FROM bookings b WHERE b.provider_id = p.id) AS total_bookings,
           (SELECT count(*)::int FROM bookings b WHERE b.provider_id = p.id AND b.status = 'COMPLETED') AS completed,
           (SELECT count(*)::int FROM bookings b JOIN users cu ON cu.id = b.user_id WHERE b.provider_id = p.id AND (cu.data_origin IS NULL OR cu.data_origin = 'REAL')) AS business_customer_bookings,
           (SELECT count(*)::int FROM bookings b JOIN users cu ON cu.id = b.user_id WHERE b.provider_id = p.id AND cu.data_origin IS NOT NULL AND cu.data_origin <> 'REAL') AS nonbusiness_customer_bookings,
           (SELECT count(*)::int FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.provider_id = p.id AND s.data_origin IS NOT NULL AND s.data_origin <> 'REAL') AS fixture_service_bookings,
           (SELECT max(b.created_at) FROM bookings b WHERE b.provider_id = p.id) AS last_booking,
           (SELECT min(b.created_at) FROM bookings b WHERE b.provider_id = p.id) AS first_booking,
           cardinality(p.service_categories)::int AS services_offered,
           (SELECT count(*)::int FROM services s WHERE s.category = ANY(p.service_categories) AND s.data_origin IS NOT NULL AND s.data_origin <> 'REAL') AS fixture_services_offered
    FROM providers p JOIN users u ON u.id = p.user_id
    LEFT JOIN partner_presence pp ON pp.provider_id = p.id
    WHERE u.data_origin IS NULL AND p.lifecycle_state = 'ACTIVE' AND p.compliance_restricted = false
    ORDER BY u.created_at`;
  const { emails, decrypted, failed } = await resolveUserEmails(prisma, "op4-unclassified-provider-review");

  const report = rows.map((r) => {
    const email = emails.get(r.user_id) ?? null;
    const rule = classifyUserEmail(email);
    const signals: string[] = [];
    if (/(test|fixture|adv|cert|seed|demo|e2e|qa|fake|dummy)/i.test(`${r.first_name} ${r.last_name} ${r.business_name ?? ""}`)) signals.push("test-word in name");
    if (/^prov_|^p_|cert|fixture|test/i.test(r.provider_id)) signals.push("non-cuid/test-shaped provider id");
    // (category-based "offers fixture services" is not evidence: every partner in a category matches.)
    if (r.fixture_service_bookings > 0) signals.push(`${r.fixture_service_bookings} booking(s) on fixture services`);
    if (r.nonbusiness_customer_bookings > 0) signals.push(`${r.nonbusiness_customer_bookings} booking(s) from classified-synthetic customers`);
    const production: string[] = [];
    if (r.is_phone_verified) production.push("phone verified");
    if (r.is_verified) production.push("provider verified");
    if (r.background_check_status !== "NOT_DONE") production.push(`background check ${r.background_check_status}`);
    if (r.business_customer_bookings > 0) production.push(`${r.business_customer_bookings} booking(s) from business customers`);
    if (r.completed > 0) production.push(`${r.completed} completed`);
    const eshape = shape(email);
    if (email && /@[^.]+[.]demo$/i.test(email)) signals.push("e-mail TLD .demo is not in the DNS root (undeliverable)");
    const emailIsPhonePlaceholder = eshape.includes("phone-placeholder");
    const testish = signals.length;
    let confidence: string; let recommendation: string;
    if (testish >= 2 && production.filter((p) => !p.startsWith("phone")).length === 0) { confidence = "HIGH synthetic"; recommendation = "owner to declare INFERRED_SYNTHETIC (no rule fires; evidence is name/id/fixture-service shaped)"; }
    else if (testish >= 1) { confidence = "MEDIUM synthetic"; recommendation = "keep UNKNOWN; owner review — synthetic signals present but not conclusive"; }
    else if (emailIsPhonePlaceholder || r.is_phone_verified || r.is_verified) { confidence = "LEANS real"; recommendation = "keep UNKNOWN (counts as business); owner may declare REAL — phone-signup/verified evidence"; }
    else { confidence = "INSUFFICIENT"; recommendation = "keep UNKNOWN; no evidence either way"; }
    return { ...r, email_shape: eshape, rule: rule?.rule ?? null, synthetic_signals: signals, production_evidence: production, confidence, recommendation };
  });

  const op3 = await prisma.$queryRaw<{ id: string; first_name: string; created_at: Date; is_phone_verified: boolean; data_origin: string | null; bookings: number }[]>`
    SELECT u.id, u.first_name, u.created_at, u.is_phone_verified, u.data_origin::text, (SELECT count(*)::int FROM bookings b WHERE b.user_id = u.id) AS bookings
    FROM users u WHERE u.id = ANY(${OP3_CUSTOMERS})`;
  const op3rows = op3.map((u) => ({ ...u, email_shape: shape(emails.get(u.id) ?? null), rule: classifyUserEmail(emails.get(u.id) ?? null)?.rule ?? null }));

  const demoUsers=[...emails.values()].filter((e)=>e&&/@[^.]+[.]demo$/i.test(e)).length;
  writeFileSync(OUT_JSON, JSON.stringify({ db, decrypted, failed, providers: report, op3: op3rows }, null, 2));

  const counts: Record<string, number> = {};
  for (const r of report) counts[r.confidence] = (counts[r.confidence] ?? 0) + 1;
  const md: string[] = [];
  md.push(`# OP-4 — unclassified dispatchable providers (review report)`, ``,
    `Generated ${new Date().toISOString()} on \`${db}\`, read-only. E-mails resolved through the repo's canonical resolver (${decrypted} decrypted, ${failed} undecryptable); only the domain and a masked shape are shown here.`, ``,
    `**Population:** ${report.length} providers with \`users.data_origin IS NULL\`, lifecycle ACTIVE, not compliance-restricted — i.e. counted as business by \`analytics-scope\` and eligible for real matching.`, ``,
    `**Rule:** no rule in \`src/lib/data-provenance.ts\` fires for any of them (that is what UNKNOWN means). Nothing here is auto-converted. Every recommendation is for the owner to act on; until then each stays UNKNOWN and is treated as business, exactly as the policy says.`, ``,
    `| Confidence | Count |`, `|---|---|`, ...Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`), ``,
    `| # | Provider id | Name / business | E-mail shape | Created | Verified / BG check | Bookings (total / completed / business-cust / synthetic-cust / fixture-svc) | Categories | Last presence | Synthetic signals | Production evidence | Confidence | Recommended handling |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  report.forEach((r, i) => md.push(`| ${i + 1} | \`${r.provider_id}\` | ${r.first_name} ${r.last_name}${r.business_name ? ` / ${r.business_name}` : ""} | ${r.email_shape} | ${r.user_created.toISOString().slice(0, 10)} | ${r.is_verified ? "verified" : "unverified"} / ${r.background_check_status} | ${r.total_bookings} / ${r.completed} / ${r.business_customer_bookings} / ${r.nonbusiness_customer_bookings} / ${r.fixture_service_bookings} | ${r.services_offered} | ${r.last_heartbeat ? r.last_heartbeat.toISOString().slice(0, 10) : "never"} | ${r.synthetic_signals.join("; ") || "—"} | ${r.production_evidence.join("; ") || "—"} | ${r.confidence} | ${r.recommendation} |`));
  md.push(``, `## OP-3 customer accounts`, ``, `| User id | Name | Created | Phone verified | Provenance | Bookings | E-mail shape | Rule |`, `|---|---|---|---|---|---|---|---|`);
  for (const u of op3rows) md.push(`| \`${u.id}\` | ${u.first_name} | ${u.created_at.toISOString().slice(0, 10)} | ${u.is_phone_verified} | ${u.data_origin ?? "UNKNOWN"} | ${u.bookings} | ${u.email_shape} | ${u.rule ?? "none"} |`);
  writeFileSync(OUT_MD, md.join("\n") + "\n");
  console.log(`users on a .demo domain: ${demoUsers}`);
  console.log(`providers: ${report.length}`, counts, `op3 customers: ${op3rows.length}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
