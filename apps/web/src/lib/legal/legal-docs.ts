/**
 * Registry of the four HOMEEIGO legal documents — routes, nav labels and the
 * document header copy each page already displayed.
 *
 * Presentation metadata only. The policy text itself stays in `legal-data.ts`,
 * which remains the single source of truth for legal wording; nothing here
 * restates a clause. This file exists so the document list is declared once
 * instead of being re-typed in the shell, the footer and the Legal Center.
 */

export type LegalDocId = "privacy" | "terms" | "cookies" | "refund";

export type LegalDoc = {
  id: LegalDocId;
  href: string;
  /** Full nav label (desktop switcher, footer, Legal Center card). */
  label: string;
  /** Compact label for the mobile switcher rail. */
  shortLabel: string;
  /** Small-caps line above the document title. */
  eyebrow: string;
  /** Document H1. */
  title: string;
  /** Lead paragraph under the title. */
  subtitle: string;
};

export const LEGAL_DOCS: readonly LegalDoc[] = [
  {
    id: "privacy",
    href: "/legal/privacy",
    label: "Privacy Policy",
    shortLabel: "Privacy",
    eyebrow: "Privacy & Data",
    title: "Your Privacy Matters",
    subtitle:
      "We are committed to protecting your personal information and maintaining complete transparency in how your data is collected, used, and protected.",
  },
  {
    id: "terms",
    href: "/legal/terms",
    label: "Terms of Service",
    shortLabel: "Terms",
    eyebrow: "Legal Agreement",
    title: "Terms of Service",
    subtitle: "The rules and responsibilities that govern use of the HOMEEIGO platform.",
  },
  {
    id: "cookies",
    href: "/legal/cookies",
    label: "Cookie Preferences",
    shortLabel: "Cookies",
    eyebrow: "Cookie & Consent",
    title: "Cookie Preferences Center",
    subtitle:
      "Manage how HOMEEIGO uses cookies and similar technologies. Compliant with GDPR (EU/UK) and India's DPDP Act — you're in control.",
  },
  {
    id: "refund",
    href: "/legal/refund",
    label: "Refund Policy",
    shortLabel: "Refunds",
    eyebrow: "Refunds & Cancellations",
    title: "Refund & Cancellation Policy",
    subtitle:
      "Clear, fair rules for cancellations and refunds — including free-cancellation windows, a rework guarantee, and fast payouts.",
  },
] as const;

export const LEGAL_HOME = "/legal";

export function getLegalDoc(id: LegalDocId): LegalDoc {
  const doc = LEGAL_DOCS.find((d) => d.id === id);
  if (!doc) throw new Error(`Unknown legal document: ${id}`);
  return doc;
}
