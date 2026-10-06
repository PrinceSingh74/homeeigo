"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Clock, Headphones, LifeBuoy, Mail } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { SupportCenter } from "@/components/support/SupportCenter";
import { pageLead, pageTitle } from "@/lib/page-layout";
import { SUPPORT_FAQS } from "@/lib/faq/faq-data";
import { useAuthStore } from "@/stores/auth-store";

const SUPPORT_EMAIL = "support@homigo.app";

const FAQS = SUPPORT_FAQS;

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
          Raise a ticket and track replies from our support team.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {/* No phone tile and no response-time tile. The phone tile printed one placeholder number
            and dialled another; the response time is each ticket's own deadline from the server,
            shown on the ticket, not a fixed figure here. */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <span className="block text-xs text-muted">Shown on each ticket</span>
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
