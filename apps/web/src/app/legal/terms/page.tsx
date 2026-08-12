import type { Metadata } from "next";
import { TermsReader } from "@/components/legal/TermsReader";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The rules and responsibilities that govern use of the HOMEEIGO platform — accounts, bookings, payments, refunds, liability, dispute resolution and more.",
  alternates: { canonical: "/legal/terms" },
  openGraph: {
    title: "HOMEEIGO Terms of Service",
    description: "The rules and responsibilities that govern use of the HOMEEIGO platform.",
    type: "article",
  },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return <TermsReader />;
}
