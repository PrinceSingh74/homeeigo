import type { Metadata } from "next";
import { CookieConsentCenter } from "@/components/legal/CookieConsentCenter";

export const metadata: Metadata = {
  title: "Cookie Preferences Center",
  description:
    "Manage how HOMEEIGO uses cookies and similar technologies. GDPR (EU/UK) and India DPDP compliant — accept, reject or customize each category with full consent history.",
  alternates: { canonical: "/legal/cookies" },
  openGraph: {
    title: "HOMEEIGO Cookie Preferences Center",
    description: "Manage how HOMEEIGO uses cookies and similar technologies.",
    type: "article",
  },
  robots: { index: true, follow: true },
};

export default function CookiePolicyPage() {
  return <CookieConsentCenter />;
}
