/**
 * Second re-audit, 2026-10-06. Copy that stated rules, timings or checks the server does not back,
 * marketing that called a rule-and-score matcher "AI", and hardcoded demo data left where a
 * component could wire it back in.
 *
 * Run from apps/web: `bun test tests/truth`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { walletOffersFromServer } from "@/lib/wallet-offers";
import { SUPPORT_FAQS } from "@/lib/faq/faq-data";

const srcRoot = join(import.meta.dir, "..", "..", "src");
const src = (rel: string) => readFileSync(join(srcRoot, rel), "utf8");
const found = (rel: string, needles: (string | RegExp)[]) => {
  const text = src(rel);
  return needles.filter((n) => (typeof n === "string" ? text.includes(n) : n.test(text))).map(String);
};

describe("support FAQ states no rule or number of its own", () => {
  const answer = (q: RegExp) => SUPPORT_FAQS.find((f) => q.test(f.q))!.a;

  test("cancellation: no fee rule; points at the terms shown before confirming and the refund policy", () => {
    const a = answer(/cancel a booking/i);
    expect(a).not.toMatch(/free|small fee|before the pro is assigned/i);
    expect(a).toMatch(/before you confirm/i);
    expect(a).toMatch(/refund policy/i);
  });

  test("refund timing: no number; refers to the refund policy", () => {
    const a = answer(/get my refund/i);
    expect(a).not.toMatch(/\d|instant/i);
    expect(a).toMatch(/refund policy/i);
  });

  test("professionals: approval for all, further checks only where a service requires them", () => {
    const a = answer(/professionals/i);
    expect(a).not.toMatch(/every pro completes|skill assessment/i);
    expect(a).toMatch(/approved/i);
    expect(a).toMatch(/where a service requires/i);
  });
});

describe("no response-time promise without a ticket's own deadline", () => {
  test("refund-request toast and the new-ticket dialog", () => {
    expect(found("hooks/use-core-data.ts", ["within 24 hours"])).toEqual([]);
    expect(found("components/support/SupportCenter.tsx", ["within 2 hours"])).toEqual([]);
  });
});

describe("support offers only channels that exist, with no availability or speed promise", () => {
  test("no call-back that nobody receives, no placeholder phone number, no 24/7 or response-time claim", () => {
    expect(found("components/overlays/SupportModal.tsx", ["24/7", "5 minutes", "requestSupportCallback", "1800", "tel:"])).toEqual([]);
    expect(found("app/(with-bottom-nav)/(aurora-nav)/support/page.tsx", ["24/7", "under 2 hours", "1800", "tel:"])).toEqual([]);
    expect(found("app/(with-bottom-nav)/(aurora-nav)/support/layout.tsx", ["24/7", "fast response"])).toEqual([]);
    expect(found("app/not-found.tsx", ["24/7"])).toEqual([]);
    expect(found("stores/app-store.ts", ["within 5 minutes", "requestSupportCallback"])).toEqual([]);
  });
});

describe("home reviews are the customer's words or nothing", () => {
  test("no stand-in review text and no invented coverage claim", () => {
    expect(found("components/home/ReviewsSectionServer.tsx", ["Great service experience", "Gurugram"])).toEqual([]);
  });
});

describe("matching is not called AI, and professionals are not called verified", () => {
  test("hero badge, AI page metadata and quick actions", () => {
    expect(found("components/home/HeroSectionServer.tsx", [/AI-Powered/i])).toEqual([]);
    expect(found("components/ai/AiQuickActions.tsx", [/AI-powered/i])).toEqual([]);
    expect(found("app/(with-bottom-nav)/ai/page.tsx", [/AI-powered/i, "smart diagnostics"])).toEqual([]);
  });

  const AI = [/AI-powered/i, /AI matching/i, /smart matching/i];
  test("site metadata, signup, CTA, footer, home metadata", () => {
    expect(found("app/layout.tsx", AI)).toEqual([]);
    expect(found("app/signup/page.tsx", [...AI, /verified/i])).toEqual([]);
    expect(found("components/auth/SignupForm.tsx", AI)).toEqual([]);
    expect(found("components/FinalCtaSection.tsx", AI)).toEqual([]);
    expect(found("components/layout/SiteFooter.tsx", [...AI, /Verified pros/])).toEqual([]);
    expect(found("app/(with-bottom-nav)/(aurora-nav)/page.tsx", [...AI, /verified/i])).toEqual([]);
  });

  test("trust strips and the location picker", () => {
    expect(found("components/TrustSection.tsx", [/"Verified"/, /"Background"/, "AI Fraud", "24/7"])).toEqual([]);
    expect(found("components/services-catalog/home-help/HomeHelpLanding.tsx", ["Verified professionals", "On-time service"])).toEqual([]);
    expect(found("components/overlays/LocationPicker.tsx", [/verified/i])).toEqual([]);
  });
});

describe("a service row shows only its own server fields", () => {
  test("no provider paired by index, no stand-in pro, no fixed duration", () => {
    expect(found("hooks/use-services-discovery.ts", ["providers[i]", "HOMEEIGO Pro", "60-120 mins", "useProvidersQuery", "images.unsplash.com"])).toEqual([]);
  });
});

describe("dead demo data is deleted, not parked", () => {
  test("the services-page showcase file is gone", () => {
    expect(existsSync(join(srcRoot, "lib", "services-page-data.ts"))).toBe(false);
  });

  test("the marketplace data file keeps only what is imported", () => {
    expect(found("lib/services-marketplace-data.ts", ["4.9", "50,000", "10,000", /guarantee/i, /money back/i, "₹", "TRUST_POINTS", "HOME_CARE_SERVICES", "REVIEW_TRUST_STATS"])).toEqual([]);
  });

  test("no demo wallet balance, transactions, offers, trend or sparkline", () => {
    expect(found("lib/wallet.ts", ["Rahul", "MOCK_BUSINESS_DATA_ENABLED"])).toEqual([]);
    expect(found("lib/wallet-dashboard.ts", ["CLEAN15", "AC100", "% OFF", "WALLET_SPARKLINE", "WALLET_SPEND_CHANGE_PCT", "WALLET_TOTAL_BALANCE"])).toEqual([]);
    expect(found("components/wallet/WalletRightRail.tsx", ["HMG", "Special Offer", "Limited period", "compared to last month", "WALLET_"])).toEqual([]);
  });
});

describe("walletOffersFromServer", () => {
  test("nothing from the server is no offers — no stand-in code or title", () => {
    for (const empty of [undefined, null, [], "x"]) expect(walletOffersFromServer(empty)).toEqual([]);
  });

  test("an offer without a title, or switched off, is dropped — not filled in", () => {
    expect(walletOffersFromServer([{ id: "b", code: "X1" }, null, { id: "c", title: "  " }, { id: "d", title: "Old", isActive: false }])).toEqual([]);
  });

  test("the server's own words and figures; a code only when the server sent one", () => {
    // The shape /api/wallet/offers returns today carries no code at all.
    expect(
      walletOffersFromServer([
        { id: "offer_first_booking", title: "First Booking Discount", description: "20% off on your first booking", discount: 20, isActive: true },
        { id: "o2", title: "Flat", amount: 50, code: "FLAT50" },
      ]),
    ).toEqual([
      { id: "offer_first_booking", title: "First Booking Discount", description: "20% off on your first booking", badge: "20% off", code: null },
      { id: "o2", title: "Flat", description: "", badge: "₹50", code: "FLAT50" },
    ]);
  });
});
