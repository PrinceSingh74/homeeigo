/**
 * The FAQ copy HOMEEIGO already publishes to customers.
 *
 * ── Why this file exists ───────────────────────────────────────────────────────
 *
 * These questions and answers were already shipped — they were written inline in two page
 * components. That made them impossible to govern: the knowledge base could not cite a page
 * component, and nothing stopped the two surfaces drifting from whatever the platform indexed.
 *
 * Nothing here is newly written. Every string is the text those pages already rendered, moved
 * verbatim, so this file is a relocation of official copy and not an authoring of it. The pages now
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
    a: "Open Bookings, select the booking and choose Reschedule or Cancel. Cancellations before the pro is assigned are free; later cancellations may have a small fee.",
  },
  {
    q: "When will I get my refund?",
    a: "Wallet refunds are instant. Refunds to your original payment method (card/UPI) take 5–7 business days depending on your bank.",
  },
  {
    q: "How does the HOMEEIGO wallet work?",
    a: "Add money via Razorpay (UPI, card, netbanking) and pay for any booking instantly. Cashback and referral earnings also land in your wallet.",
  },
  {
    q: "Are HOMEEIGO professionals verified?",
    a: "Yes — every pro completes ID verification, background checks, and skill assessment before going live on the platform.",
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
