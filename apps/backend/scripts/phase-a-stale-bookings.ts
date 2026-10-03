/**
 * Phase A / live-closure step B — the four stale bookings: preflight, and (owner-executed) cancel
 * through the canonical admin path. Never a raw status write; `bookingService.cancel` owns the
 * refund, the audit context, the offer cleanup, the outbox event and the notifications.
 *
 *   DRY RUN (default, DB-enforced read-only session, loads no money service):
 *     bun run scripts/phase-a-stale-bookings.ts --url "<postgres url>"
 *     bun run scripts/phase-a-stale-bookings.ts --url "<postgres url>" --only <bookingNumber> --refund-policy <policy>
 *
 *   APPLY (one booking):
 *     bun run scripts/phase-a-stale-bookings.ts --url "<postgres url>" --only <bookingNumber> \
 *       --refund-policy <customer_policy|full> --confirm <token printed by the dry run> \
 *       --apply --actor <SUPER_ADMIN user id> [--provider-mode-verified <LIVE|TEST>] [--allow-live]
 *
 *   APPLY (all four): replace `--only …` with `--all-four`; the token is the batch token.
 *
 * What this script decides and what it does not. It decides NOTHING about money: the refund policy
 * is the application's own `AdminRefundPolicy` vocabulary and has no default here, the amount is
 * computed by the application's own cancellation policy, and the provider mode of a historical
 * payment is never inferred from today's credential — the owner states what the provider's
 * dashboard shows. The script's job is to make the consequence of each choice visible BEFORE it is
 * taken, and to refuse when what was confirmed is no longer what would happen.
 *
 * Facts measured on live `homigo_db`, read-only, 2026-09-27 (they replace the earlier header,
 * which was wrong about three of the four bookings):
 *   …0612-00073  ASSIGNED, unpaid, no payments row. Nothing is refunded, recorded or announced.
 *   …0615-00003  EN_ROUTE, wallet-funded (a completed ₹989 wallet debit, no payments row). Cancel
 *                CREDITS THE CUSTOMER'S WALLET; it is not "₹0".
 *   …0615-00012  EN_ROUTE, gateway payment ₹550, settled. Refund goes to the provider with the
 *                credential this process holds. Its provider mode is not recorded anywhere locally.
 *   …0824-00006  ACCEPTED, a payments row LABELLED `wallet` that carries a gateway payment id
 *                (`pay_e2edemo000000001`, fabricated by a demo script). It is a gateway tender: the
 *                provider is asked, and will reject an id it has never seen. No wallet credit.
 *
 * Two defects this trace found in the application were fixed before this script was finalised
 * (`src/lib/refund-tender.ts`, `bookingService.cancel`; tests in
 * `src/__tests__/refund-tender-evidence.integration.test.ts`): the refund tender used to follow the
 * payment-method LABEL, so `…00006` would have minted wallet credit; and an unpaid cancellation
 * used to record the quote and tell the customer a refund was on the way.
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { cancellationPolicyFromSnapshot, cancellationPolicyService, type AdminRefundPolicy } from "../src/services/cancellation-policy.service";
import { resolvePaymentEnvironment } from "../src/lib/payment-environment";
// Pure, import-free: the SAME rule the refund service applies, not a copy of it.
import { arrivedThroughGateway, isWalletTender, refundTenderLabel } from "../src/lib/refund-tender";

// ── The closed set this script may ever touch ───────────────────────────────────────────────────
const NUMBERS = [
  "HOMIGO-20260612-00073",
  "HOMIGO-20260615-00003",
  "HOMIGO-20260615-00012",
  "HOMIGO-20260824-00006",
] as const;
const REASON = "stale test booking — Phase A disposition (owner-authorized closure, 2026-09-27)";

/** The application's vocabulary (`AdminRefundPolicy`), restated only to validate a CLI string. */
const REFUND_POLICIES: readonly AdminRefundPolicy[] = ["customer_policy", "full"];
const PROVIDER_MODES = ["LIVE", "TEST"] as const;
type ProviderMode = (typeof PROVIDER_MODES)[number];
/**
 * What the owner found in the provider's dashboard. NOT_FOUND is a real answer, not a missing one:
 * the payment id exists in neither mode (a demo script fabricated it), so the provider will reject
 * the refund and nothing can move.
 */
const VERIFIED_MODES = ["LIVE", "TEST", "NOT_FOUND"] as const;
type VerifiedMode = (typeof VERIFIED_MODES)[number];
const TERMINAL = ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "COMPLETED", "EXPIRED", "REJECTED"];
const SPLIT_PAYMENT_METHOD = "wallet_razorpay_split";

// ── Arguments ───────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
function value(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? "" : v;
}
function refuse(message: string): never {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
}

const KNOWN_FLAGS = new Set([
  "--url", "--only", "--all-four", "--refund-policy", "--provider-mode-verified",
  "--confirm", "--apply", "--actor", "--allow-live",
]);
for (const a of argv) {
  if (a.startsWith("--") && !KNOWN_FLAGS.has(a)) refuse(`unknown option ${a}. Nothing was read or written.`);
}

const APPLY = has("--apply");
const url = value("--url");
const only = value("--only");
const allFour = has("--all-four");
const policyArg = value("--refund-policy");
const verifiedArg = value("--provider-mode-verified");
const confirm = value("--confirm");
const actor = value("--actor");
const allowLive = has("--allow-live");

if (!url) refuse("--url is required. This script never inherits DATABASE_URL.");
if (only !== undefined && allFour) refuse("--only and --all-four are mutually exclusive.");
if (only === "") refuse("--only needs a booking number.");

/**
 * `--only` is matched EXACTLY against the closed list. Not a prefix, not case-folded, not a
 * database lookup: a booking number that is not one of the four is refused before any connection
 * is opened, so a typo can never select a different booking that happens to exist.
 */
if (only !== undefined && !(NUMBERS as readonly string[]).includes(only)) {
  refuse(`--only "${only}" is not one of the four bookings this script may touch:\n  ${NUMBERS.join("\n  ")}`);
}

if (policyArg !== undefined && !(REFUND_POLICIES as readonly string[]).includes(policyArg)) {
  refuse(
    `--refund-policy "${policyArg}" is not a policy the application defines. ` +
      `AdminRefundPolicy is exactly: ${REFUND_POLICIES.join(" | ")}.`,
  );
}
const policy = policyArg as AdminRefundPolicy | undefined;

if (verifiedArg !== undefined && !(VERIFIED_MODES as readonly string[]).includes(verifiedArg)) {
  refuse(
    `--provider-mode-verified must be LIVE, TEST or NOT_FOUND — what the provider's dashboard shows for the payment ` +
      `(NOT_FOUND = looked up in both modes, present in neither).`,
  );
}
const verifiedMode = verifiedArg as VerifiedMode | undefined;

if (APPLY) {
  // The authorization this script has always required. Its presence is checked here; that it is an
  // ACTIVE SUPER_ADMIN on the target database is checked below, against that database.
  if (!actor) refuse("--apply needs --actor <adminUserId>.");
  if (only === undefined && !allFour) {
    refuse(
      "--apply needs a target: --only <bookingNumber> for one booking. " +
        "Cancelling all four in one run needs the explicit --all-four AND the batch token (--confirm) " +
        "that a dry run with --all-four prints.",
    );
  }
  if (!policy) {
    refuse(
      `--apply needs --refund-policy. There is no default: it decides how much money moves.\n` +
        `  customer_policy  the amount the customer's own cancellation terms give (a fee applies)\n` +
        `  full             everything still refundable, no fee\n` +
        `Run the dry run without --refund-policy to see both amounts for each booking.`,
    );
  }
  if (!confirm) refuse("--apply needs --confirm <token>. Run the same command without --apply and --actor to get it.");
}

const targets: string[] = only !== undefined ? [only] : [...NUMBERS];

// ── Connection ──────────────────────────────────────────────────────────────────────────────────
/**
 * A dry run is read-only because the DATABASE says so, not because this file is careful: the
 * session is opened with `default_transaction_read_only=on`, so a write from anywhere in this
 * process is an error rather than a mistake.
 */
function readOnlyUrl(u: string): string {
  const opt = "options=-c%20default_transaction_read_only%3Don";
  return u.includes("?") ? `${u}&${opt}` : `${u}?${opt}`;
}
process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url: APPLY ? url : readOnlyUrl(url) } } });

// ── Facts ───────────────────────────────────────────────────────────────────────────────────────
type Tender =
  | "NONE_UNPAID"
  | "NONE_ZERO"
  | "NONE_PAYMENT_NOT_REFUNDABLE"
  | "WALLET_FUNDED"
  | "WALLET_VIA_PAYMENT_ROW"
  | "GATEWAY"
  | "PENDING_NO_PROVIDER_ID"
  | "SPLIT";

type Facts = {
  number: string;
  id: string;
  status: string;
  paymentStatus: string;
  bookingPaymentMethod: string | null;
  scheduledDate: Date;
  finalAmount: number;
  frozenPolicy: string | null;
  /** The terms frozen on the booking; null for rows created before snapshots (platform policy applies). */
  cancellationPolicy: ReturnType<typeof cancellationPolicyFromSnapshot>;
  userId: string;
  payment: null | {
    id: string;
    method: string;
    status: string;
    amount: number;
    amountPaid: number;
    refunded: number;
    providerPaymentId: string | null;
    providerOrderId: string | null;
    settlementId: string | null;
    storedMode: ProviderMode | null;
  };
  inFlightRefunds: number;
  refundRequests: number;
  walletDebitPaise: bigint;
  walletRefundedPaise: bigint;
  openJobs: number;
};

const paise = (rupees: number) => BigInt(Math.round(rupees * 100));
const rupees = (p: bigint) => Number(p) / 100;
const inr = (n: number) => `₹${n.toFixed(2)}`;

async function columnExists(table: string, column: string): Promise<boolean> {
  const [r] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}) AS present`;
  return r?.present === true;
}

async function facts(number: string): Promise<Facts | null> {
  const b = await prisma.booking.findUnique({
    where: { bookingNumber: number },
    select: {
      id: true, status: true, paymentStatus: true, paymentMethod: true, scheduledDate: true,
      finalAmount: true, userId: true, serviceConfigSnapshot: true,
    },
  });
  if (!b) return null;

  const p = await prisma.payment.findUnique({ where: { bookingId: b.id } });
  let storedMode: ProviderMode | null = null;
  if (p && (await columnExists("payments", "environment"))) {
    const [row] = await prisma.$queryRaw<{ environment: string | null }[]>`SELECT environment FROM payments WHERE id = ${p.id}`;
    storedMode = row?.environment === "LIVE" || row?.environment === "TEST" ? row.environment : null;
  }

  const inFlight = p
    ? await prisma.refundRequest.aggregate({
        where: { paymentId: p.id, status: { in: ["REFUNDING", "PROCESSING", "INDETERMINATE"] } },
        _sum: { amount: true },
      })
    : null;
  const refundRequests = p ? await prisma.refundRequest.count({ where: { paymentId: p.id } }) : 0;

  // Exactly the reads `walletFundedRefundable` performs (booking-refund.service.ts).
  const [w] = await prisma.$queryRaw<{ paid: bigint; refunded: bigint }[]>`
    SELECT
      coalesce(sum(amount_paise) FILTER (
        WHERE type::text = 'DEBIT' AND reference_type = 'booking_wallet_payment'), 0)::bigint AS paid,
      coalesce(sum(amount_paise) FILTER (
        WHERE type::text = 'REFUND' AND reference_type IN ('booking_cancel_refund', 'booking_admin_refund')), 0)::bigint AS refunded
    FROM wallet_transactions
    WHERE reference_id = ${b.id} AND user_id = ${b.userId} AND status::text = 'COMPLETED'`;

  const openJobs = await prisma.assignmentJob.count({ where: { bookingId: b.id, status: { in: ["PENDING", "DISPATCHED"] } } });

  return {
    number,
    id: b.id,
    status: b.status,
    paymentStatus: b.paymentStatus,
    bookingPaymentMethod: b.paymentMethod,
    scheduledDate: b.scheduledDate,
    finalAmount: b.finalAmount,
    frozenPolicy: cancellationPolicyFromSnapshot(b.serviceConfigSnapshot)?.version ?? null,
    cancellationPolicy: cancellationPolicyFromSnapshot(b.serviceConfigSnapshot),
    userId: b.userId,
    payment: p
      ? {
          id: p.id,
          method: p.paymentMethod,
          status: p.status,
          amount: p.amount,
          amountPaid: p.amountPaid,
          refunded: p.refundedAmount ?? 0,
          providerPaymentId: p.razorpayPaymentId,
          providerOrderId: p.razorpayOrderId,
          settlementId: p.settlementId,
          storedMode,
        }
      : null,
    inFlightRefunds: inFlight?._sum.amount ?? 0,
    refundRequests,
    walletDebitPaise: w?.paid ?? 0n,
    walletRefundedPaise: w?.refunded ?? 0n,
    openJobs,
  };
}

/**
 * What `bookingRefundService.refundableRemaining` returns, from the same reads.
 *
 * Mirrored, not imported: importing the money services would construct the application's Prisma
 * singleton, and a dry run must not load anything capable of writing. The mirror is pinned by
 * `scripts/__tests__/phase-a-stale-bookings.test.ts`, which applies on the isolated test database
 * and requires the outcome to equal what this function predicted.
 */
function refundableRemaining(f: Facts): number | null {
  const walletRemaining = f.walletDebitPaise - f.walletRefundedPaise > 0n ? f.walletDebitPaise - f.walletRefundedPaise : 0n;
  const p = f.payment;
  if (!p) {
    const walletFunded = f.bookingPaymentMethod === "wallet" && f.paymentStatus === "SUCCESS";
    return walletFunded ? rupees(walletRemaining) : null;
  }
  const gatewayPaid = ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED", "REFUNDING"].includes(p.status);
  const isSplit = p.method === SPLIT_PAYMENT_METHOD;
  if (!gatewayPaid && !(isSplit && f.walletDebitPaise > 0n)) return null;
  let gatewayRemaining = 0n;
  if (gatewayPaid) {
    gatewayRemaining = paise(p.amountPaid || p.amount) - paise(p.refunded) - paise(f.inFlightRefunds);
    if (gatewayRemaining < 0n) gatewayRemaining = 0n;
  }
  return rupees(gatewayRemaining + (isSplit ? walletRemaining : 0n));
}

type Plan = {
  tier: string;
  feePercent: number;
  feeAmount: number;
  /** What the policy returns on the amount in question. Informational: for an unpaid booking it has no money behind it. */
  quotedRefund: number;
  /** What `bookingService.cancel` writes to `bookings.refund_amount`, the event and the notification. */
  recordedRefund: number;
  /** What actually moves. */
  movedAmount: number;
  tender: Tender;
  notes: string[];
};

function plan(f: Facts, p: AdminRefundPolicy): Plan {
  const remaining = f.paymentStatus === "SUCCESS" ? refundableRemaining(f) : null;
  const quote = cancellationPolicyService.calculate({
    paidAmount: remaining ?? f.finalAmount,
    scheduledDate: f.scheduledDate,
    bookingStatus: f.status,
    cancelledBy: "admin",
    adminRefundPolicy: p,
    paymentMethod: refundTenderLabel(
      f.payment ? { paymentMethod: f.payment.method, razorpayPaymentId: f.payment.providerPaymentId } : null,
      f.bookingPaymentMethod,
    ),
    // The booking's OWN frozen terms — what `bookingService.cancel` charges by.
    policy: f.cancellationPolicy,
  });
  const notes: string[] = [];
  // Exactly `bookingService.cancel`: a refund is recorded and announced only when it will be made.
  const recordedRefund = quote.refundAmount > 0 && f.paymentStatus === "SUCCESS" ? quote.refundAmount : 0;
  const base = {
    tier: quote.tier, feePercent: quote.feePercent, feeAmount: quote.feeAmount,
    quotedRefund: quote.refundAmount, recordedRefund,
  };

  // The order below is the order of the branches in `processCancellationRefund`.
  if (f.paymentStatus !== "SUCCESS") {
    notes.push("nothing was paid: no refund is recorded, announced or made. The notification says only that support cancelled the booking.");
    return { ...base, movedAmount: 0, tender: "NONE_UNPAID", notes };
  }
  if (quote.refundAmount <= 0) return { ...base, movedAmount: 0, tender: "NONE_ZERO", notes };
  if (f.payment?.method === SPLIT_PAYMENT_METHOD) {
    notes.push("split tender: not one of the four shapes this script was written for");
    return { ...base, movedAmount: quote.refundAmount, tender: "SPLIT", notes };
  }
  if (!f.payment) {
    const walletFunded = f.bookingPaymentMethod === "wallet";
    if (!walletFunded) return { ...base, movedAmount: 0, tender: "NONE_PAYMENT_NOT_REFUNDABLE", notes };
    return { ...base, movedAmount: quote.refundAmount, tender: "WALLET_FUNDED", notes };
  }
  if (f.payment.status !== "SUCCESS" && f.payment.status !== "PARTIALLY_REFUNDED") {
    return { ...base, movedAmount: 0, tender: "NONE_PAYMENT_NOT_REFUNDABLE", notes };
  }
  const evidence = { paymentMethod: f.payment.method, razorpayPaymentId: f.payment.providerPaymentId };
  if (f.payment.method.toLowerCase() === "wallet" && arrivedThroughGateway(evidence)) {
    notes.push(
      `the payments row is LABELLED "wallet" but carries the gateway payment ${f.payment.providerPaymentId}: ` +
        `it is refunded through the gateway, to where the money came from — not as wallet credit.`,
    );
  }
  if (isWalletTender(evidence)) {
    if (f.walletDebitPaise === 0n) {
      notes.push(
        "NO wallet debit exists for this booking. The payments-row wallet path checks the payments row only, " +
          "so the credit is not backed by money the wallet ever paid.",
      );
    }
    if (f.payment.providerPaymentId) {
      notes.push(`the payments row carries provider id ${f.payment.providerPaymentId}, but its method is "wallet": the provider is NOT called.`);
    }
    return { ...base, movedAmount: quote.refundAmount, tender: "WALLET_VIA_PAYMENT_ROW", notes };
  }
  if (!f.payment.providerPaymentId) return { ...base, movedAmount: quote.refundAmount, tender: "PENDING_NO_PROVIDER_ID", notes };
  return { ...base, movedAmount: quote.refundAmount, tender: "GATEWAY", notes };
}

// ── Credential ──────────────────────────────────────────────────────────────────────────────────
/** The credential THIS process would hand the provider. Prefix only; the key is never printed. */
const credential = resolvePaymentEnvironment(process.env.RAZORPAY_KEY_ID);
const credentialConfigured = Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim());
const credentialLabel = !credentialConfigured
  ? "NONE (the application's dev-mock refund path would answer; no provider is contacted)"
  : credential.environment === "UNCONFIGURED"
    ? "UNRECOGNISED KEY FORMAT (cannot be classified as LIVE or TEST)"
    : `${credential.environment} (${credential.keyPrefix}…)`;

// ── Preflight ───────────────────────────────────────────────────────────────────────────────────
function paymentMode(f: Facts): { label: string; effective: VerifiedMode | null } {
  if (!f.payment || !f.payment.providerPaymentId) return { label: "NOT APPLICABLE (no provider payment)", effective: null };
  if (f.payment.storedMode) return { label: `${f.payment.storedMode} (recorded on the payment row)`, effective: f.payment.storedMode };
  if (verifiedMode === "NOT_FOUND") {
    return { label: "NOT FOUND at the provider in either mode (stated by the owner via --provider-mode-verified)", effective: "NOT_FOUND" };
  }
  if (verifiedMode) return { label: `${verifiedMode} (stated by the owner via --provider-mode-verified; not recorded locally)`, effective: verifiedMode };
  return { label: "UNKNOWN — not recorded locally. Verify in the provider dashboard.", effective: null };
}

function token(f: Facts, p: AdminRefundPolicy, pl: Plan, db: string): string {
  // Everything the owner was shown and nothing that moves with the clock.
  const material = JSON.stringify([
    db, f.number, f.id, f.status, f.paymentStatus, p, pl.tender, pl.tier, pl.quotedRefund, pl.recordedRefund, pl.movedAmount,
    f.payment?.id ?? null, f.payment?.providerPaymentId ?? null, f.payment?.refunded ?? null,
    paymentMode(f).effective, credentialConfigured ? credential.environment : "NONE",
    f.walletDebitPaise.toString(), f.walletRefundedPaise.toString(),
  ]);
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function effects(f: Facts, pl: Plan): { wallet: string; provider: string; ledger: string; irreversible: string[] } {
  const amount = inr(pl.movedAmount);
  const irreversible = [
    `booking → CANCELLED_BY_USER (cancelled_by = admin). The database refuses any status change out of a terminal status.`,
    `one booking.cancelled outbox event, delivered to every consumer by the running backend`,
    `customer notification (in-app row + device push) "cancelled by Homeeigo support"; partner notification "Booking Cancelled"`,
    `admin action + booking audit rows naming the actor`,
  ];
  if (f.openJobs > 0) irreversible.push(`${f.openJobs} open assignment job(s) closed`);

  switch (pl.tender) {
    case "WALLET_FUNDED":
      irreversible.push(`customer wallet balance +${amount} — spendable immediately`);
      return {
        wallet: `CREDIT ${amount} to user ${f.userId} (wallet transaction REFUND / booking_cancel_refund, key wallet-cancel-refund:${f.id})`,
        provider: "NONE — no provider call, no refund_requests row, no payments row (there is no payments row)",
        ledger: `journal wallet_booking_refund:${f.id} — PLATFORM_ESCROW debit ${amount} / CUSTOMER_WALLET credit ${amount}`,
        irreversible,
      };
    case "WALLET_VIA_PAYMENT_ROW":
      irreversible.push(`customer wallet balance +${amount} — spendable immediately`);
      return {
        wallet: `CREDIT ${amount} to user ${f.userId} (wallet transaction REFUND / booking_cancel_refund, key wallet-cancel-refund:${f.id})`,
        provider: `NONE — no provider call. refund_requests row cancel-refund:${f.id} = COMPLETED with gateway_refund_id "wallet:<txn>"; payment → ${pl.movedAmount >= (f.payment!.amountPaid || f.payment!.amount) - f.payment!.refunded - 0.005 ? "REFUNDED" : "PARTIALLY_REFUNDED"}`,
        ledger: `journal wallet_booking_refund:${f.id} — PLATFORM_ESCROW debit ${amount} / CUSTOMER_WALLET credit ${amount}`,
        irreversible,
      };
    case "GATEWAY": {
      const full = pl.movedAmount >= (f.payment!.amountPaid || f.payment!.amount) - f.payment!.refunded - 0.005;
      if (paymentMode(f).effective === "NOT_FOUND") {
        // The owner looked the payment up and the provider has never seen it. The refund is still
        // ASKED for — the canonical cancel path always asks — and the rejection is the honest record.
        irreversible.push(`a refund request the provider will reject; it is recorded FAILED and retried with backoff at most 5 times`);
        return {
          wallet: "NONE",
          provider:
            `ONE refund request of ${amount} on ${f.payment!.providerPaymentId}, which the provider is EXPECTED TO REJECT ` +
            `(payment not found). refund_requests = FAILED, payment back to SUCCESS, booking stays cancelled with ` +
            `refund_status = pending. NO MONEY MOVES. The refund retry sweep re-asks at most 5 times, then stops.`,
          ledger: "NONE — a rejected refund writes no journal",
          irreversible,
        };
      }
      irreversible.push(`a provider refund of ${amount} on ${f.payment!.providerPaymentId} — a provider refund cannot be recalled`);
      return {
        wallet: "NONE",
        provider:
          `ONE refund request of ${amount} on ${f.payment!.providerPaymentId}, sent with the ${credentialLabel} credential, ` +
          `idempotency key cancel-refund:${f.id}. On success: refund_requests = COMPLETED with the provider refund id; ` +
          `payment → ${full ? "REFUNDED" : "PARTIALLY_REFUNDED"}, refunded_amount +${amount}. ` +
          `On a definite rejection: refund_requests = FAILED, payment back to SUCCESS, booking stays cancelled. ` +
          `On a lost answer: refund_requests = INDETERMINATE, payment stays REFUNDING, no retry until reconciled.`,
        ledger: `on success only: journal refund:<provider refund id> — REFUND_LIABILITY debit ${amount} / CUSTOMER_FUNDS credit ${amount}`,
        irreversible,
      };
    }
    case "PENDING_NO_PROVIDER_ID":
      return { wallet: "NONE", provider: "NONE — refund_requests row marked pending for manual handling", ledger: "NONE", irreversible };
    case "SPLIT":
      return { wallet: "split — see processSplitRefund", provider: "split — see processSplitRefund", ledger: "split", irreversible };
    default:
      return { wallet: "NONE", provider: "NONE", ledger: "NONE", irreversible };
  }
}

function printPreflight(f: Facts, p: AdminRefundPolicy, pl: Plan, db: string): string {
  const e = effects(f, pl);
  const t = token(f, p, pl, db);
  const mode = paymentMode(f);
  const lines = [
    `PREFLIGHT  ${f.number}`,
    `  BOOKING               ${f.number}  id=${f.id}  status=${f.status}  payment_status=${f.paymentStatus}  scheduled=${f.scheduledDate.toISOString()}`,
    `  PAYMENT METHOD        ${f.payment ? `payments row ${f.payment.id}: method=${f.payment.method} status=${f.payment.status} paid=${inr(f.payment.amountPaid || f.payment.amount)} refunded=${inr(f.payment.refunded)} provider_payment=${f.payment.providerPaymentId ?? "-"} provider_order=${f.payment.providerOrderId ?? "-"} settlement=${f.payment.settlementId ?? "-"}` : `no payments row; booking.payment_method=${f.bookingPaymentMethod ?? "-"}; wallet debit for this booking=${inr(rupees(f.walletDebitPaise))}`}`,
    `  PAYMENT MODE          ${mode.label}`,
    `  EXECUTING CREDENTIAL  ${credentialLabel}`,
    `  POLICY                ${p}  →  tier=${pl.tier}  fee=${pl.feePercent}% (${inr(pl.feeAmount)})  frozen policy on booking=${f.frozenPolicy ?? "none (platform policy applies)"}`,
    `  REFUND AMOUNT         policy quote ${inr(pl.quotedRefund)}; recorded and announced ${inr(pl.recordedRefund)}; ACTUALLY MOVED ${inr(pl.movedAmount)}  [${pl.tender}]`,
    `  WALLET EFFECT         ${e.wallet}`,
    `  PROVIDER EFFECT       ${e.provider}`,
    `  LEDGER EFFECT         ${e.ledger}`,
    `  IRREVERSIBLE EFFECTS`,
    ...e.irreversible.map((x) => `    - ${x}`),
    ...(pl.notes.length ? [`  ATTENTION`, ...pl.notes.map((x) => `    ! ${x}`)] : []),
    `  CONFIRMATION TOKEN    ${t}`,
  ];
  console.log(lines.join("\n"));
  return t;
}

/** Conditions under which the provider must not be contacted at all. Returned, never thrown. */
function gatewayRefusal(f: Facts, pl: Plan, dbIsTest: boolean): string | null {
  if (pl.tender === "SPLIT") return "split tender is outside what this script was written and tested for.";
  if (pl.tender !== "GATEWAY") return null;
  if (!credentialConfigured) {
    if (dbIsTest) return null; // the dev-mock path, on a test database
    return (
      "this process holds no provider credential, so the application's dev-mock path would answer SUCCESS " +
      "with an invented refund id. On a non-test database that is a fabricated refund record."
    );
  }
  if (credential.environment === "UNCONFIGURED") return "the configured credential is neither rzp_live_ nor rzp_test_; it cannot be matched to the payment's mode.";
  const mode = paymentMode(f).effective;
  if (!mode) {
    return (
      `the provider mode of ${f.payment!.providerPaymentId} is not recorded locally and was not stated. ` +
      `Look the payment up in the provider dashboard (check BOTH Test and Live mode) and pass ` +
      `--provider-mode-verified LIVE or --provider-mode-verified TEST.`
    );
  }
  if (mode === "NOT_FOUND") return null; // the provider's rejection IS the expected, honest outcome
  if (mode !== credential.environment) {
    return (
      `the payment is ${mode} and this process holds a ${credential.environment} credential. ` +
      `A ${credential.environment} credential cannot refund a ${mode} payment; the call would be rejected ` +
      `or would report success while moving nothing.`
    );
  }
  return null;
}

// ── Apply ───────────────────────────────────────────────────────────────────────────────────────
async function assertSameDatabase(): Promise<void> {
  /**
   * The application's services use the application's own Prisma singleton, which reads
   * DATABASE_URL when it is first imported. This proves the singleton ended up on the database
   * named by --url, and not on whatever a dotenv file says, BEFORE anything is written through it.
   */
  const { default: app } = await import("../src/lib/prisma");
  const q = `SELECT current_database() AS db, inet_server_port() AS port, (SELECT system_identifier::text FROM pg_control_system()) AS sys`;
  const [mine] = await prisma.$queryRawUnsafe<{ db: string; port: number; sys: string }[]>(q);
  const [theirs] = await app.$queryRawUnsafe<{ db: string; port: number; sys: string }[]>(q);
  if (mine.db !== theirs.db || mine.port !== theirs.port || mine.sys !== theirs.sys) {
    refuse(
      `the application's database connection is "${theirs.db}" (port ${theirs.port}) but --url is "${mine.db}" (port ${mine.port}). ` +
        `Nothing was written.`,
    );
  }
}

async function assertSuperAdmin(id: string): Promise<void> {
  const a = await prisma.user.findUnique({
    where: { id },
    select: { id: true, adminProfile: { select: { isActive: true, role: { select: { name: true } } } } },
  });
  if (!a?.adminProfile?.isActive || a.adminProfile.role.name !== "SUPER_ADMIN") {
    refuse("--actor is not an active SUPER_ADMIN on this database. Nothing was written.");
  }
}

async function settle(bookingId: string): Promise<string | null> {
  // `bookingService.cancel` starts the refund DETACHED, after its commit. Reading the rows straight
  // away reports the state before the refund ran; wait for the refund to leave "pending".
  for (let i = 0; i < 300; i++) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b?.refundStatus !== "pending") return b?.refundStatus ?? null;
    await new Promise((r) => setTimeout(r, 200));
  }
  return "pending";
}

async function printAfter(f: Facts): Promise<void> {
  const b = await prisma.booking.findUnique({
    where: { id: f.id },
    select: { status: true, paymentStatus: true, refundStatus: true, refundAmount: true, cancelledBy: true },
  });
  const p = f.payment ? await prisma.payment.findUnique({ where: { id: f.payment.id } }) : null;
  const rr = f.payment ? await prisma.refundRequest.findMany({ where: { paymentId: f.payment.id }, select: { idempotencyKey: true, status: true, amount: true, gatewayRefundId: true } }) : [];
  const wt = await prisma.walletTransaction.findMany({ where: { referenceId: f.id, type: "REFUND" }, select: { amount: true, status: true, idempotencyKey: true } });
  const u = await prisma.user.findUnique({ where: { id: f.userId }, select: { walletBalance: true } });
  console.log(
    [
      `AFTER  ${f.number}`,
      `  booking          status=${b?.status} cancelled_by=${b?.cancelledBy} refund_status=${b?.refundStatus} refund_amount=${b?.refundAmount}`,
      `  payment          ${p ? `status=${p.status} refunded_amount=${p.refundedAmount} provider_refund_id=${p.razorpayRefundId ?? "-"}` : "no payments row"}`,
      `  refund_requests  ${rr.length ? rr.map((r) => `${r.idempotencyKey}:${r.status}:${inr(r.amount)}:${r.gatewayRefundId ?? "-"}`).join("  ") : "none"}`,
      `  wallet refunds   ${wt.length ? wt.map((w) => `${w.idempotencyKey}:${w.status}:${inr(w.amount)}`).join("  ") : "none"}`,
      `  wallet balance   ${u ? inr(u.walletBalance) : "?"}`,
    ].join("\n"),
  );
}

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
  const dbIsTest = /test/i.test(db);
  // A dry run proves its session is read-only instead of assuming the URL option took effect.
  const [{ ro }] = await prisma.$queryRawUnsafe<{ ro: string }[]>(
    "SELECT current_setting('default_transaction_read_only') AS ro",
  );
  if (!APPLY && ro !== "on") {
    refuse(`the dry-run session is not read-only (default_transaction_read_only=${ro}). Nothing further was read.`);
  }
  console.log(`\n[phase-a bookings] ${APPLY ? "APPLY" : `DRY RUN (session default_transaction_read_only=${ro})`} on "${db}"`);
  console.log(`target: ${only ?? (allFour ? "ALL FOUR (--all-four)" : "all four (listing only)")}   policy: ${policy ?? "not chosen"}   credential: ${credentialLabel}`);
  console.log("=".repeat(100));

  if (APPLY && !dbIsTest && !allowLive) {
    refuse(`"${db}" is not a test database. A live run needs --allow-live as well. Nothing was written.`);
  }

  const all: Facts[] = [];
  for (const n of targets) {
    const f = await facts(n);
    if (!f) refuse(`${n} does not exist on "${db}". Nothing was written.`);
    all.push(f);
  }

  // ── Dry run without a policy: the decision table, and nothing else ──
  if (!policy) {
    for (const f of all) {
      console.log(`\n${f.number}  ${f.status}/${f.paymentStatus}  scheduled=${f.scheduledDate.toISOString().slice(0, 10)}`);
      if (TERMINAL.includes(f.status)) {
        console.log("  already terminal — nothing to decide");
        continue;
      }
      for (const p of REFUND_POLICIES) {
        const pl = plan(f, p);
        console.log(`  --refund-policy ${p.padEnd(16)} tier=${pl.tier.padEnd(11)} fee=${String(pl.feePercent).padStart(2)}%  quoted=${inr(pl.quotedRefund).padStart(9)}  moved=${inr(pl.movedAmount).padStart(9)}  [${pl.tender}]`);
      }
    }
    console.log(`\n${"=".repeat(100)}\nNo --refund-policy was given, so no preflight and no token were produced. Nothing was written.`);
    return;
  }

  // ── Preflight for every target ──
  const live = all.filter((f) => !TERMINAL.includes(f.status));
  for (const f of all.filter((x) => TERMINAL.includes(x.status))) {
    console.log(`\n${f.number}  ${f.status} — already terminal, nothing to do`);
  }
  const prepared = live.map((f) => {
    console.log("");
    const pl = plan(f, policy);
    const t = printPreflight(f, policy, pl, db);
    const refusal = gatewayRefusal(f, pl, dbIsTest);
    if (refusal) console.log(`  APPLY WOULD BE REFUSED  ${refusal}`);
    return { f, pl, t, refusal };
  });

  const batchToken =
    prepared.length > 0
      ? createHash("sha256").update(prepared.map((x) => x.t).join("|")).digest("hex").slice(0, 16)
      : null;
  if (allFour && batchToken) console.log(`\nBATCH CONFIRMATION TOKEN (${prepared.length} booking(s))  ${batchToken}`);

  if (!APPLY) {
    console.log(`\n${"=".repeat(100)}\nDRY RUN — nothing was written.`);
    return;
  }

  // ── Apply ──
  if (prepared.length === 0) {
    console.log(`\n${"=".repeat(100)}\nNothing to do: every target is already terminal. Nothing was written.`);
    return;
  }
  const expected = allFour ? batchToken : prepared[0].t;
  if (confirm !== expected) {
    refuse(
      `--confirm ${confirm} does not match the preflight above (${expected}). Either the command differs from the ` +
        `dry run that produced the token, or the booking changed since. Read the preflight again. Nothing was written.`,
    );
  }
  const blocked = prepared.find((x) => x.refusal);
  if (blocked) refuse(`${blocked.f.number}: ${blocked.refusal} Nothing was written.`);

  await assertSuperAdmin(actor!);
  await assertSameDatabase();

  const { adminBookingOperationsService } = await import("../src/services/admin-booking-operations.service");
  for (const { f } of prepared) {
    console.log(`\nAPPLYING  ${f.number}`);
    try {
      const r = await adminBookingOperationsService.cancelBooking(f.id, actor!, REASON, "phase-a-script", policy);
      console.log(`  cancelled → status=${r.status} quoted refund=₹${r.refundAmount} policy=${r.refundPolicy}`);
      const settled = await settle(f.id);
      if (settled === "pending") console.log("  refund still pending after 60 s — it is NOT complete; read the rows below and reconcile before anything else");
    } catch (err) {
      console.log(`  CANCEL FAILED: ${err instanceof Error ? err.message : String(err)} — left as-is (no raw write)`);
    }
    await printAfter(f);
  }
  // The services start their audit, push and realtime writes detached (`void …`). There is no
  // handle to await, so the process stays up long enough for them to land before it exits.
  await new Promise((r) => setTimeout(r, 5_000));
  console.log(`\n${"=".repeat(100)}\n[phase-a bookings] DONE`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
