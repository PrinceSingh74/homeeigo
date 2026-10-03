/**
 * O9 — read-only classification of ACCEPTED-but-unpaid bookings (owner decision 2026-09-23:
 * NO retroactive TTL; classify, do not rewrite).
 *
 * This script **never writes**. It reads booking, payment and ledger state and assigns each booking
 * exactly one class, so remediation can be decided individually with evidence rather than applied in
 * bulk. Gateway state is NOT fetched here: asking Razorpay about hundreds of orders is a live
 * external call, and the classes below already separate "we hold a captured payment" from "we cannot
 * tell from our own records".
 *
 *   PAYMENT_CAPTURED        our records show settled money for this booking
 *   PAYMENT_INDETERMINATE   a gateway order exists and is unsettled — only the gateway can say
 *   PAYMENT_NOT_FOUND       no payment row and no gateway order: nothing was ever started
 *   LEGACY_UNPAID           unpaid and its appointment is already in the past
 *   ALREADY_OPERATIONAL     work has progressed or finished despite the payment state
 *   OTHER_EXPLICIT_STATE    anything the rules above do not cover (never silently bucketed)
 *
 * Usage (read-only; it announces the database it reached before reading anything):
 *   DATABASE_URL=<the target> bun scripts/classify-accepted-unpaid-bookings.ts
 */
import prisma from "../src/lib/prisma";
import { announceDdlTarget, parseDdlTarget } from "../src/lib/ddl-target-guard";

type Row = {
  id: string;
  booking_number: string;
  status: string;
  payment_status: string;
  scheduled_date: Date;
  created_at: Date;
  final_amount: number;
  provider_id: string | null;
  payment_id: string | null;
  payment_row_status: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  journal_count: bigint;
};

type Klass =
  | "PAYMENT_CAPTURED"
  | "PAYMENT_INDETERMINATE"
  | "PAYMENT_NOT_FOUND"
  | "LEGACY_UNPAID"
  | "ALREADY_OPERATIONAL"
  | "OTHER_EXPLICIT_STATE";

const SETTLED = new Set(["SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED", "REFUNDING"]);
const UNSETTLED = new Set(["PENDING", "INITIATED", "PROCESSING"]);
const OPERATIONAL = new Set(["EN_ROUTE", "IN_PROGRESS", "COMPLETED"]);

function classify(r: Row, now: Date): { klass: Klass; why: string } {
  if (SETTLED.has(r.payment_status) || (r.payment_row_status && SETTLED.has(r.payment_row_status)) || Number(r.journal_count) > 0) {
    return { klass: "PAYMENT_CAPTURED", why: `booking=${r.payment_status} payment=${r.payment_row_status ?? "none"} journals=${r.journal_count}` };
  }
  if (OPERATIONAL.has(r.status)) {
    return { klass: "ALREADY_OPERATIONAL", why: `work reached ${r.status} while payment is ${r.payment_status}` };
  }
  if (r.razorpay_order_id && !r.razorpay_order_id.startsWith("pending:")) {
    return { klass: "PAYMENT_INDETERMINATE", why: `gateway order ${r.razorpay_order_id} exists and is unsettled — only the gateway can resolve it` };
  }
  if (r.scheduled_date.getTime() < now.getTime()) {
    return { klass: "LEGACY_UNPAID", why: `appointment ${r.scheduled_date.toISOString()} already passed, unpaid` };
  }
  if (!r.payment_id && !r.razorpay_order_id) {
    return { klass: "PAYMENT_NOT_FOUND", why: "no payment row and no gateway order: checkout was never started" };
  }
  return { klass: "OTHER_EXPLICIT_STATE", why: `status=${r.status} payment=${r.payment_status} paymentRow=${r.payment_row_status ?? "none"} order=${r.razorpay_order_id ?? "none"}` };
}

/**
 * This script performs no DDL and no writes, so it does not `assertDdlTarget` — that would refuse a
 * live target, and reading live data is the whole point. It still STATES which database it reached
 * before touching it, because a report about "the bookings" is worthless without naming the source,
 * and the repository's DDL-guard coverage check rightly refuses a script that reaches a database
 * silently.
 */
const target = parseDdlTarget(process.env.DATABASE_URL);
if (target) announceDdlTarget("classify-accepted-unpaid-bookings (READ ONLY)", target);

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
const now = new Date();

const rows = await prisma.$queryRaw<Row[]>`
  SELECT b.id, b.booking_number, b.status::text AS status, b.payment_status::text AS payment_status,
         b.scheduled_date, b.created_at, b.final_amount, b.provider_id,
         p.id AS payment_id, p.status::text AS payment_row_status,
         p.razorpay_order_id, p.razorpay_payment_id,
         (SELECT count(*) FROM journal_entries j WHERE j.reference_id = p.id AND j.reference_type = 'payment')::bigint AS journal_count
  FROM bookings b
  LEFT JOIN payments p ON p.booking_id = b.id
  WHERE b.status = 'ACCEPTED'
    AND b.payment_status IN ('PENDING', 'INITIATED', 'PROCESSING')
  ORDER BY b.created_at ASC
`;

const buckets = new Map<Klass, Row[]>();
const reasons = new Map<string, string>();
for (const r of rows) {
  const { klass, why } = classify(r, now);
  const list = buckets.get(klass) ?? [];
  list.push(r);
  buckets.set(klass, list);
  reasons.set(r.id, why);
}

const lines: string[] = [];
lines.push(`O9 — ACCEPTED-but-unpaid booking classification (READ ONLY, no rows were modified)`);
lines.push(`database: ${db}`);
lines.push(`generated: ${now.toISOString()}`);
lines.push(`owner decision 2026-09-23: NO retroactive 15-minute TTL. These rows are legacy operational state.`);
lines.push(``);
lines.push(`total ACCEPTED + unsettled payment: ${rows.length}`);
lines.push(``);
lines.push(`| class | bookings | value (INR) |`);
lines.push(`|---|---|---|`);
for (const [klass, list] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const value = list.reduce((sum, r) => sum + (r.final_amount ?? 0), 0);
  lines.push(`| ${klass} | ${list.length} | ${Math.round(value * 100) / 100} |`);
}
lines.push(``);
for (const [klass, list] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`## ${klass} (${list.length})`);
  for (const r of list) {
    lines.push(
      `  ${r.booking_number}  id=${r.id}  scheduled=${r.scheduled_date.toISOString()}  amount=${r.final_amount}  ` +
        `provider=${r.provider_id ?? "none"}  order=${r.razorpay_order_id ?? "none"}  gatewayPayment=${r.razorpay_payment_id ?? "none"}`,
    );
    lines.push(`      → ${reasons.get(r.id)}`);
  }
  lines.push(``);
}
lines.push(`Remediation guidance: only individually justified action may alter any of these rows.`);
lines.push(`PAYMENT_INDETERMINATE is the only class that needs a gateway question before any decision.`);

console.log(lines.join("\n"));
await prisma.$disconnect();
