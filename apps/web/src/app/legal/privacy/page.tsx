import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/legal/PrivacyPolicy";

export const metadata: Metadata = {
  title: "Privacy Policy & Data Disclosure",
  description:
    "How HOMEEIGO collects, uses, shares and protects your personal data — with a full Google Play style data disclosure. Encrypted, GDPR-ready, account deletion available.",
  alternates: { canonical: "/legal/privacy" },
  openGraph: {
    title: "Your Privacy Matters — HOMEEIGO Privacy Policy",
    description:
      "Complete transparency on how your data is collected, used, and protected across the HOMEEIGO platform.",
    type: "article",
  },
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicy />;
}
