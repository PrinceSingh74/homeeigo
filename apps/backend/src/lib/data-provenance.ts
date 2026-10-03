/**
 * Provenance classification rules — the single place that decides what a historical row looks like.
 *
 * Context: on 2026-09-21, 97% of `refund_requests` were test or certification artifacts and the only
 * record of that fact was free text somebody typed into `reason`. Provenance is now a column
 * (`DataOrigin`), but the historical rows predate it, so they have to be classified from the markers
 * that do exist.
 *
 * Three rules govern everything here:
 *
 *   1. **Inferred is not declared.** Every classification this module produces is an `INFERRED_*`
 *      value. A regex over prose is evidence, not testimony. Only the code path that CREATES a row
 *      may declare a plain `TEST` / `CERTIFICATION` / `FIXTURE` / `REAL`.
 *
 *   2. **Uncertain stays UNKNOWN.** A row that matches nothing returns `null` and its column stays
 *      NULL. Nothing is promoted to REAL to improve an analytic, and nothing is marked synthetic
 *      merely because it looks suspicious.
 *
 *   3. **Every classification is reproducible.** Each rule carries the pattern that fired, so a
 *      label can always be traced back to the exact evidence that produced it.
 */
import type { DataOrigin } from "@prisma/client";

export type ClassificationRule = {
  /** Stable identifier, recorded alongside the label so a result can be audited later. */
  id: string;
  origin: DataOrigin;
  pattern: RegExp;
  /** Why this pattern implies this origin. */
  because: string;
};

/**
 * Refund-reason rules, ordered most-specific first.
 *
 * Derived from the 18 distinct `reason` values observed in `homigo_db`. Deliberately anchored to
 * markers a human wrote on purpose — "f2 cert", "phase-5a certification" — rather than loose words
 * like "test", which appears in legitimate prose.
 */
export const REFUND_REASON_RULES: ClassificationRule[] = [
  {
    id: "refund.cert.f2",
    origin: "INFERRED_CERTIFICATION",
    pattern: /\bf2 (cert|identity|ai path)\b/i,
    because: "F2 fault-injection certification suite marker",
  },
  {
    id: "refund.cert.phase",
    origin: "INFERRED_CERTIFICATION",
    pattern: /\bphase-\d+[a-z]? certification\b/i,
    because: "Phase certification run marker",
  },
  {
    id: "refund.cert.scenario",
    origin: "INFERRED_CERTIFICATION",
    pattern: /\b(t\d{2} race|adv rbac test|independent audit)\b/i,
    because: "Named certification scenario",
  },
  {
    id: "refund.test.e2e",
    origin: "INFERRED_TEST",
    pattern: /\be2e\b/i,
    because: "End-to-end suite marker",
  },
  {
    id: "refund.test.ui-verification",
    origin: "INFERRED_TEST",
    pattern: /created accidentally during automated ui verification/i,
    because: "Row explicitly describes itself as an automated-verification artifact",
  },
  {
    id: "refund.test.cleanup",
    origin: "INFERRED_TEST",
    pattern: /^\s*(e2e )?cleanup\s*$/i,
    because: "Suite cleanup marker (anchored: 'cleanup' alone, not inside prose)",
  },
  {
    id: "refund.synthetic.fault-injection",
    origin: "INFERRED_SYNTHETIC",
    pattern: /^\s*gateway (rejection|timeout)\s*$/i,
    because: "Injected gateway fault, not a gateway fault that occurred",
  },
];

/**
 * E-mail rules for users.
 *
 * Only `example.com`/`.test`/`.invalid` (reserved by RFC 2606 and therefore never a real mailbox)
 * and explicit `+e2e`-style tags are used. A bare substring like "test" is NOT a rule: real people
 * have addresses containing it, and mislabelling a real customer as synthetic would remove them from
 * business analytics — a worse error than leaving them UNKNOWN.
 */
export const USER_EMAIL_RULES: ClassificationRule[] = [
  {
    id: "user.reserved-domain",
    origin: "INFERRED_SYNTHETIC",
    pattern: /@(example\.(com|org|net)|.*\.(test|invalid|localhost))$/i,
    because: "RFC 2606 reserved domain — cannot be a deliverable mailbox",
  },
  {
    // Not a word match on "demo": this exact domain is hard-coded by the application's own seed and
    // certification scripts (scripts/ensure-demo-users.ts, section03-seed-live-job.ts,
    // section05-live-cert.ts, live-demo-*.ts), which is testimony about who creates these rows.
    // `.demo` is also not a delegated top-level domain, so the address cannot receive mail.
    id: "user.seed-domain",
    origin: "INFERRED_SYNTHETIC",
    pattern: /@homigo\.demo$/i,
    because: "The application's own seed/certification scripts create accounts on this undelegated domain",
  },
  {
    id: "user.plus-tag.suite",
    origin: "INFERRED_TEST",
    pattern: /\+(e2e|smoke|test|fixture|seed|cert)[^@]*@/i,
    because: "Plus-addressed tag naming an automated suite",
  },
];

export type Classification = {
  origin: DataOrigin;
  ruleId: string;
  because: string;
  /** The text the rule matched, so the decision can be re-read later. */
  evidence: string;
};

function applyRules(rules: ClassificationRule[], value: string | null | undefined): Classification | null {
  if (!value) return null;
  for (const rule of rules) {
    const m = value.match(rule.pattern);
    if (m) {
      return { origin: rule.origin, ruleId: rule.id, because: rule.because, evidence: m[0] };
    }
  }
  return null;
}

/** Classify a refund from its reason. Returns null when no rule fires — the row stays UNKNOWN. */
export function classifyRefundReason(reason: string | null | undefined): Classification | null {
  return applyRules(REFUND_REASON_RULES, reason);
}

/**
 * Reserved-domain addresses that THIS application generates for real people, and which therefore
 * must never be read as evidence of a synthetic account.
 *
 * `routes/auth.ts` gives every customer who signs up with a phone OTP the placeholder address
 * `p<hash>@phone.homeeigo.invalid`. `.invalid` is RFC 2606 reserved, so `user.reserved-domain`
 * matched it and would have labelled every phone-signup customer INFERRED_SYNTHETIC — removing real
 * customers from every business report. Measured 2026-09-21 once addresses were resolved through
 * decryption (they had never been seen before): 4 such accounts, all genuine sign-ups.
 *
 * Checked before any rule so no future rule can match it either.
 */
export const APP_GENERATED_PLACEHOLDER_DOMAINS = ["phone.homeeigo.invalid"] as const;

/** Classify a user from their e-mail. Returns null when no rule fires. */
export function classifyUserEmail(email: string | null | undefined): Classification | null {
  const domain = email?.split("@")[1]?.toLowerCase();
  if (domain && (APP_GENERATED_PLACEHOLDER_DOMAINS as readonly string[]).includes(domain)) return null;
  return applyRules(USER_EMAIL_RULES, email);
}

/**
 * Evidence that one harness run produced the account, the booking and the refund together.
 */
export type SameRunEvidence = {
  accountCreatedAt: Date;
  bookingCreatedAt: Date;
  firstRefundAt: Date;
};

/** How close together three rows must be to count as one run. */
export const SAME_RUN_WINDOW_MS = 60 * 60 * 1000;

/**
 * A booking inherits from the refunds raised against it — but only when the same run made both.
 *
 * The original premise was "a booking that a certification suite refunded was created by that
 * suite". That was measured on 2026-09-21 and holds for **1 of 100** bookings it would have
 * labelled. The other 99 belong to five long-lived accounts: 62 were booked by accounts over a
 * week old, 46 were refunded more than a week after booking, 71 carry live-shaped gateway ids, and
 * 5 have written reviews on the public home page. A harness refunding a booking says the *refund*
 * was a test. It says nothing about who made the booking.
 *
 * Inferring a parent's provenance from a child is the defect: it turns UNKNOWN — which the analytics
 * policy counts as business precisely so real history fails safe — into non-business on evidence
 * about a different row. Applied, it would have removed ₹54,849 of paid GMV from every business
 * report and hidden real reviews from customers.
 *
 * So inheritance now needs corroboration: the account, the booking and the first classified refund
 * all within `SAME_RUN_WINDOW_MS` of one another, which is what a harness that created all three
 * looks like. Otherwise the booking stays UNKNOWN and the refund carries the label on its own.
 * `run` is required rather than optional so no caller can skip the check by omission.
 */
export function classifyBookingFromRefunds(
  refundClassifications: Classification[],
  run: SameRunEvidence,
): Classification | null {
  if (refundClassifications.length === 0) return null;
  const t = [run.accountCreatedAt, run.bookingCreatedAt, run.firstRefundAt].map((d) => d.getTime());
  if (Math.max(...t) - Math.min(...t) > SAME_RUN_WINDOW_MS) return null;
  // Certification outranks test outranks synthetic — the strongest claim about the row wins.
  const order: DataOrigin[] = ["INFERRED_CERTIFICATION", "INFERRED_TEST", "INFERRED_SYNTHETIC", "INFERRED_FIXTURE"];
  for (const origin of order) {
    const hit = refundClassifications.find((c) => c.origin === origin);
    if (hit) {
      return {
        origin,
        ruleId: `booking.inherit:${hit.ruleId}`,
        because: `Inherited from a refund on this booking (${hit.because})`,
        evidence: hit.evidence,
      };
    }
  }
  return null;
}

/**
 * Booking-number rules.
 *
 * The only production path that mints a booking number is `nextBookingNumber()` in
 * `lib/booking-number.ts`, and it produces exactly `HOMIGO-YYYYMMDD-NNNNN`. Certification and E2E
 * scripts write their own prefixes (`S03L-`, `S07-`, `ADV-`, `WPIC-`, …) straight into the column,
 * so a number that the generator could not have produced is structural evidence that a script
 * created the row. Measured on homigo_db 2026-09-24: 196 such bookings, every one UNKNOWN and
 * therefore counted as business by every analytic.
 *
 * The rule is the *format*, not a list of prefixes, so the 44th script is caught as surely as the
 * first. It fires only on a mismatch; a canonical number says nothing either way and stays UNKNOWN.
 */
export const CANONICAL_BOOKING_NUMBER = /^HOMIGO-\d{8}-\d{5}$/;

export const BOOKING_NUMBER_RULES: ClassificationRule[] = [
  {
    id: "booking.non-canonical-number",
    origin: "INFERRED_TEST",
    pattern: /^(?!HOMIGO-\d{8}-\d{5}$).+$/,
    because: "Booking number was not minted by lib/booking-number.ts — only scripts write other formats",
  },
];

/** Classify a booking from its number. Returns null for a canonical number — that is not evidence. */
export function classifyBookingNumber(bookingNumber: string | null | undefined): Classification | null {
  if (!bookingNumber || CANONICAL_BOOKING_NUMBER.test(bookingNumber)) return null;
  const c = applyRules(BOOKING_NUMBER_RULES, bookingNumber);
  // Record the prefix as the evidence, not the whole number: it is what a reader needs to re-check.
  return c ? { ...c, evidence: bookingNumber.split("-")[0] ?? bookingNumber } : null;
}

/** Every rule, for documentation and for the report's legend. */
export const ALL_RULES: ClassificationRule[] = [...REFUND_REASON_RULES, ...USER_EMAIL_RULES, ...BOOKING_NUMBER_RULES];

/**
 * W2-D4 — the provenance a NEW user row should be created with.
 *
 * The same evidence-based rules `provenance-report` applies to history, applied at the moment of
 * creation instead of in a later backfill. When a rule fires (an RFC 2606 reserved domain, a plus
 * tag naming an automated suite) the row is born classified. When none fires the result is EMPTY,
 * so the column stays NULL — UNKNOWN, which the analytics policy counts as business. Nothing here
 * ever declares a row REAL: that would be inventing a classification, which the owner forbids.
 *
 * Signup never set this column before, which is how all 324 providers on homigo_db came to be
 * UNKNOWN — 37 of the 84 dispatchable ones on reserved domains that cannot receive mail.
 */
export function provenanceForNewUser(email: string | null | undefined): { dataOrigin?: DataOrigin } {
  const classification = classifyUserEmail(email);
  return classification ? { dataOrigin: classification.origin } : {};
}
