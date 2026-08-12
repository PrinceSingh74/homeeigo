import type { Metadata } from "next";
import { RefundPolicy } from "@/components/legal/RefundPolicy";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy",
  description:
    "HOMEEIGO's cancellation and refund policy — free-cancellation windows, cancellation fee tiers, rework guarantee, refund methods and timelines for bookings and wallet payments.",
  alternates: { canonical: "/legal/refund" },
  openGraph: {
    title: "HOMEEIGO Refund & Cancellation Policy",
    description: "Clear, fair rules for cancellations and refunds, with fast payouts.",
    type: "article",
  },
  robots: { index: true, follow: true },
};

export default function RefundPolicyPage() {
  return <RefundPolicy />;
}
