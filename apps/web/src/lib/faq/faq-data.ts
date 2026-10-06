/**
 * The FAQ copy HOMEEIGO already publishes to customers.
 *
 * ── Why this file exists ───────────────────────────────────────────────────────
 *
 * These questions and answers were already shipped — they were written inline in two page
 * components. That made them impossible to govern: the knowledge base could not cite a page
 * component, and nothing stopped the two surfaces drifting from whatever the platform indexed.
 *
 * The copy was moved here verbatim from those pages (a relocation, not an authoring). Since then
 * three support answers were corrected on 2026-10-06 because they stated things the platform does
 * not do: a cancellation-fee rule that is not the server's policy, refund timings as fixed numbers,
 * and identity/background/skill checks for every professional. Any knowledge-base copy seeded from
 * the earlier text needs the same correction. The pages now
 * import from here, which makes this the system of record a citation can point at — the same role
 * `legal-data.ts` plays for the policy documents.
 *
 * ── Audience is derived, not chosen ────────────────────────────────────────────
 *
 * Each set records the route that publishes it. `/support` is not in `PROTECTED_ROUTE_PREFIXES`
 * (`src/lib/auth/routes.ts`), so signed-out visitors read those answers: they are public. `/membership`
 * is protected, so its answers are shown only to signed-in customers. The knowledge audience is read
 * off that routing fact rather than picked, and if the routing table changes this comment is wrong
 * in a way a reader can check.
 */

export type FaqEntry = {
  q: string;
  a: string;
};

export type FaqSet = {
  /** Stable key. Also the knowledge `documentKey` suffix, so the two cannot drift apart silently. */
  key: string;
  title: string;
  /** The route that publishes this set to users. Determines who may read it. */
  route: string;
  entries: FaqEntry[];
};

/** Published on `/support`, which is not an authenticated route. */
export const SUPPORT_FAQS: FaqEntry[] = [
  {
    q: "How do I reschedule or cancel a booking?",
    // No fee rule is stated here: the terms that apply are the server's cancellation policy, which
    // the app shows before a cancellation is confirmed and the refund policy page renders.
    a: "Open Bookings, select the booking and choose Reschedule or Cancel. The cancellation terms that apply, including any fee, are shown before you confirm a cancellation and are set out in our Refund Policy.",
  },
  {
    q: "When will I get my refund?",
    a: "It depends on how you paid. The timing for wallet and card/UPI refunds is set out in our Refund Policy, and the refund for a cancellation is shown before you confirm it.",
  },
  {
    q: "How does the HOMEEIGO wallet work?",
    a: "Add money via Razorpay (UPI, card, netbanking) and pay for any booking instantly. Cashback and referral earnings also land in your wallet.",
  },
  {
    q: "Are HOMEEIGO professionals verified?",
    // Universal: admin approval before a professional can be given any job. Identity and
    // background checks are matching gates only on services whose configuration requires them.
    a: "Every professional is approved by our team before they can be given a job. Identity and background checks apply where a service requires them, and a service's page says what is checked for it.",
  },
];

/** Published on `/membership`, which requires a signed-in customer. */
export const MEMBERSHIP_FAQS: FaqEntry[] = [
  {
    q: "How does billing work?",
    a: "You pay once per billing period via Razorpay (UPI, card, or netbanking). With auto-renew on, your plan renews automatically at the end of each period.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancelling stops auto-renew — your benefits stay active until the end of the period you've already paid for.",
  },
  {
    q: "When do I get cashback?",
    a: "Membership cashback is credited to your HOMEEIGO wallet after each eligible booking is completed and paid.",
  },
];

/** Every governed FAQ set, in the order a reader would encounter them. */
export const FAQ_SETS: FaqSet[] = [
  { key: "support", title: "Help & Support FAQ", route: "/support", entries: SUPPORT_FAQS },
  { key: "membership", title: "Membership FAQ", route: "/membership", entries: MEMBERSHIP_FAQS },
];
