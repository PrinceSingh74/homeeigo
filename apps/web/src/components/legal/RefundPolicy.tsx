import { Check, RotateCcw } from "lucide-react";
import { LegalHero } from "@/components/legal/LegalHero";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import {
  REFUND_SECTIONS,
  REFUND_TIERS,
  type PrivacySection,
} from "@/lib/legal/legal-data";

function RefundTierTable() {
  return (
    <div className="mt-5">
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-e2 sm:block">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Refund tiers table (scrollable)">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas/60 text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-5 py-3.5 font-semibold">When you cancel</th>
                <th scope="col" className="px-5 py-3.5 font-semibold">Cancellation fee</th>
                <th scope="col" className="px-5 py-3.5 font-semibold">What it means</th>
              </tr>
            </thead>
            <tbody>
              {REFUND_TIERS.map((t, i) => (
                <tr key={t.window} className={i % 2 ? "bg-canvas/30" : ""}>
                  <td className="px-5 py-4 font-semibold text-content">{t.window}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${
                        t.fee === "Free"
                          ? "bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300"
                          : "bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-300"
                      }`}
                    >
                      {t.fee}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-muted">{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-3 sm:hidden">
        {REFUND_TIERS.map((t) => (
          <li key={t.window} className="rounded-2xl border border-line bg-surface p-4 shadow-e1">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-content">{t.window}</p>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${
                  t.fee === "Free"
                    ? "bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300"
                    : "bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-300"
                }`}
              >
                {t.fee}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">{t.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionCard({ index, section }: { index: number; section: PrivacySection }) {
  return (
    <section
      id={section.id}
      className="scroll-mt-24 rounded-3xl border border-line bg-surface/80 p-6 shadow-e1 backdrop-blur-sm sm:p-8"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 font-display text-sm font-bold text-primary"
        >
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold text-content sm:text-2xl">{section.title}</h2>
          {section.intro ? (
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{section.intro}</p>
          ) : null}
          {section.body ? (
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{section.body}</p>
          ) : null}

          {section.id === "customer-cancellations" ? <RefundTierTable /> : null}

          {section.items?.length ? (
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {section.items.map((it) => (
                <li key={it.label} className="rounded-2xl border border-line/70 bg-canvas/40 p-4">
                  <p className="flex items-center gap-2 font-semibold text-content">
                    <Check size={15} className="text-success" aria-hidden />
                    {it.label}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{it.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function RefundPolicy() {
  return (
    <main className="min-h-screen">
      <LegalHero
        eyebrow="Refunds & Cancellations"
        title="Refund & Cancellation Policy"
        subtitle="Clear, fair rules for cancellations and refunds — including free-cancellation windows, a rework guarantee, and fast payouts."
        badges={[
          { label: "Instant wallet refunds", icon: "card" },
          { label: "Free cancellation window", icon: "shield" },
          { label: "Transparent fees", icon: "globe" },
        ]}
      >
        <p className="mx-auto mt-6 inline-flex items-center gap-2 text-sm font-medium text-muted">
          <RotateCcw size={15} className="text-primary" aria-hidden />
          Most refunds are automatic — no request needed.
        </p>
      </LegalHero>

      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <nav
          aria-label="On this page"
          className="mb-10 rounded-2xl border border-line bg-surface/70 p-4 shadow-e1 backdrop-blur-sm"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">On this page</p>
          <ul className="flex flex-wrap gap-2">
            {REFUND_SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex items-center rounded-full border border-line bg-canvas/50 px-3 py-1.5 text-xs font-medium text-content transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {String(i + 1).padStart(2, "0")}. {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-6">
          {REFUND_SECTIONS.map((s, i) => (
            <SectionCard key={s.id} index={i + 1} section={s} />
          ))}
        </div>
      </div>

      <LegalFooterNav current="/legal/refund" />
    </main>
  );
}
