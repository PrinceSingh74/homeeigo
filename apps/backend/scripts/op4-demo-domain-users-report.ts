/**
 * OP-4 (part 2) — every user whose e-mail domain ends in `.demo`, with the evidence an owner needs to
 * classify them. READ-ONLY on business tables (the e-mail resolver records DATA_DECRYPTED audit rows,
 * which is the canonical PII-access record).
 *
 * `.demo` is not an RFC 2606 reserved TLD, so `lib/data-provenance.ts` does not classify these
 * automatically, and this report does not either: it proposes, the owner decides.
 *
 *   bun run scripts/op4-demo-domain-users-report.ts
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { resolveUserEmails } from "./lib/resolve-user-emails";

const prisma = new PrismaClient();
const OUT = "D:/homigo/docs/operations/evidence/phase10-11/op4-demo-domain-users.md";

type Row = {
  id: string; role: string; first_name: string; created_at: Date; data_origin: string | null;
  is_phone_verified: boolean; is_email_verified: boolean; provider_id: string | null; provider_state: string | null;
  bookings: number; completed: number; paid: number; active: number; last_booking: Date | null; wallet_rows: number;
};

async function main() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const { emails } = await resolveUserEmails(prisma, "op4-demo-domain-review");
  const ids = [...emails.entries()].filter(([, e]) => e && /@[^@]+[.]demo$/i.test(e)).map(([id]) => id);
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT u.id, u.role::text, u.first_name, u.created_at, u.data_origin::text, u.is_phone_verified, u.is_email_verified,
           p.id AS provider_id, p.lifecycle_state::text AS provider_state,
           (SELECT count(*)::int FROM bookings b WHERE b.user_id = u.id) AS bookings,
           (SELECT count(*)::int FROM bookings b WHERE b.user_id = u.id AND b.status = 'COMPLETED') AS completed,
           (SELECT count(*)::int FROM bookings b WHERE b.user_id = u.id AND b.payment_status = 'SUCCESS') AS paid,
           (SELECT count(*)::int FROM bookings b WHERE b.user_id = u.id AND b.status IN ('PENDING','ACCEPTED','ASSIGNED','EN_ROUTE','IN_PROGRESS')) AS active,
           (SELECT max(b.created_at) FROM bookings b WHERE b.user_id = u.id) AS last_booking,
           (SELECT count(*)::int FROM wallet_transactions w WHERE w.user_id = u.id) AS wallet_rows
    FROM users u LEFT JOIN providers p ON p.user_id = u.id
    WHERE u.id = ANY(${ids}) ORDER BY u.role, u.created_at`;
  const domainOf = (id: string) => (emails.get(id) ?? "").split("@")[1] ?? "?";
  const byDomain: Record<string, number> = {};
  for (const r of rows) byDomain[domainOf(r.id)] = (byDomain[domainOf(r.id)] ?? 0) + 1;
  const md = [
    `# OP-4 (part 2) — users on a \`.demo\` domain`,
    ``,
    `Generated ${new Date().toISOString()} on \`${db}\`, read-only. ${rows.length} users. Nothing was reclassified.`,
    ``,
    `**Evidence that applies to all of them:** \`.demo\` has no delegation in the public DNS root (\`Resolve-DnsName homigo.demo\` → "DNS name does not exist"), so no address here can receive mail. That is strong evidence of seeded/demo data, but it is not one of the rules the provenance policy defines (RFC 2606 reserved domains, suite plus-tags), so the owner must decide whether to adopt it.`,
    ``,
    `| Domain | Users |`, `|---|---|`, ...Object.entries(byDomain).map(([d, n]) => `| ${d} | ${n} |`),
    ``,
    `| Role | Users | With provider row | With paid bookings | With active bookings |`, `|---|---|---|---|---|`,
    ...[...new Set(rows.map((r) => r.role))].map((role) => {
      const g = rows.filter((r) => r.role === role);
      return `| ${role} | ${g.length} | ${g.filter((r) => r.provider_id).length} | ${g.filter((r) => r.paid > 0).length} | ${g.filter((r) => r.active > 0).length} |`;
    }),
    ``,
    `## Recommended rule for the owner`,
    ``,
    `Adopt "e-mail TLD not delegated in the DNS root ⇒ INFERRED_SYNTHETIC" as a provenance rule (structural, like RFC 2606 — not a name match), then run \`provenance-report --apply\`. Until then these users count as business. Accounts with **paid** bookings are flagged below: classifying them synthetic removes their bookings from revenue analytics, which is correct only if the payments were test-mode.`,
    ``,
    `| User | Role | Created | Name | Provider | Bookings (total/completed/paid/active) | Last booking | Wallet rows | Proposed |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...rows.map((r) => `| \`${r.id}\` | ${r.role} | ${r.created_at.toISOString().slice(0, 10)} | ${r.first_name} | ${r.provider_id ? `\`${r.provider_id}\` ${r.provider_state}` : "—"} | ${r.bookings}/${r.completed}/${r.paid}/${r.active} | ${r.last_booking ? r.last_booking.toISOString().slice(0, 10) : "—"} | ${r.wallet_rows} | ${r.paid > 0 ? "INFERRED_SYNTHETIC — **owner confirm (paid bookings)**" : "INFERRED_SYNTHETIC"} |`),
  ];
  writeFileSync(OUT, md.join("\n") + "\n");
  console.log(JSON.stringify({ users: rows.length, byDomain, withPaid: rows.filter((r) => r.paid > 0).length, providers: rows.filter((r) => r.provider_id).length }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
