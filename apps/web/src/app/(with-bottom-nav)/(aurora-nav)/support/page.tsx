"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Clock, Headphones, LifeBuoy, Mail, Phone } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { SupportCenter } from "@/components/support/SupportCenter";
import { pageLead, pageTitle } from "@/lib/page-layout";
import { useAuthStore } from "@/stores/auth-store";

const SUPPORT_PHONE = "+918000123456";
const SUPPORT_EMAIL = "support@homigo.app";

const FAQS = [
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

export default function SupportPage() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const searchParams = useSearchParams();
  const initialTicketId = searchParams.get("ticket");

  return (
    <PageShell>
      <header className="mb-6 sm:mb-8">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-primary"
        >
          <ArrowLeft size={16} />
          Back home
        </Link>
        <h1 className={pageTitle}>Help & Support</h1>
        <p className={pageLead}>
          Raise a ticket, track replies in real time, and get help from our 24/7 support team.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <a
            href={`tel:${SUPPORT_PHONE}`}
            className="glass-card flex items-center gap-3 rounded-[24px] p-4 transition hover:bg-primary/5"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
              <Phone size={20} />
            </span>
            <span>
              <span className="block text-sm font-bold text-content">Call us</span>
              <span className="block text-xs text-muted">1800-123-456 · 24/7</span>
            </span>
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="glass-card flex items-center gap-3 rounded-[24px] p-4 transition hover:bg-primary/5"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Mail size={20} />
            </span>
            <span>
              <span className="block text-sm font-bold text-content">Email us</span>
              <span className="block text-xs text-muted">{SUPPORT_EMAIL}</span>
            </span>
          </a>
          <div className="glass-card flex items-center gap-3 rounded-[24px] p-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet/10 text-violet">
              <Clock size={20} />
            </span>
            <span>
              <span className="block text-sm font-bold text-content">Response time</span>
              <span className="block text-xs text-muted">Usually under 2 hours</span>
            </span>
          </div>
        </section>

        <section className="glass-card rounded-[28px] p-5 sm:p-6">
          {isAuthenticated ? (
            <SupportCenter initialTicketId={initialTicketId} />
          ) : (
            <div className="py-10 text-center">
              <Headphones className="mx-auto h-10 w-10 text-primary" />
              <p className="mt-3 font-semibold text-content">Sign in to manage support tickets</p>
              <p className="mt-1 text-sm text-muted">
                Create tickets, view conversation threads, and get real-time replies.
              </p>
              <Link
                href="/login?returnUrl=%2Fsupport"
                className="mt-4 inline-flex rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white"
              >
                Sign in
              </Link>
            </div>
          )}
        </section>

        <section className="glass-card rounded-[28px] p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-content">
            <LifeBuoy size={18} className="text-primary" />
            Frequently asked questions
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {FAQS.map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-line p-4">
                <summary className="cursor-pointer list-none text-sm font-bold text-content">
                  {q}
                </summary>
                <p className="mt-2 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
