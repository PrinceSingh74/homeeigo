import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help & Support",
  description:
    "Get help with HOMEEIGO bookings, payments, refunds, and more. 24/7 support, FAQs, and support tickets with fast response times.",
  alternates: { canonical: "/support" },
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
