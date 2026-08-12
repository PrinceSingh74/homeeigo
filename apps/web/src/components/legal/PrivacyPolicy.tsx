import { Check, Database } from "lucide-react";
import { LegalHero } from "@/components/legal/LegalHero";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { DataDisclosureTable } from "@/components/legal/DataDisclosureTable";
import {
  PRIVACY_SECTIONS,
  PRIVACY_TRUST_BADGES,
  type PrivacySection,
} from "@/lib/legal/legal-data";

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

          {section.items?.length ? (
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {section.items.map((it) => (
                <li
                  key={it.label}
                  className="rounded-2xl border border-line/70 bg-canvas/40 p-4"
                >
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

export function PrivacyPolicy() {
  return (
    <main className="min-h-screen">
      <LegalHero
        eyebrow="Privacy & Data"
        title="Your Privacy Matters"
        subtitle="We are committed to protecting your personal information and maintaining complete transparency in how your data is collected, used, and protected."
        badges={PRIVACY_TRUST_BADGES}
      />

      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        {/* On-this-page quick nav */}
        <nav
          aria-label="On this page"
          className="mb-10 rounded-2xl border border-line bg-surface/70 p-4 shadow-e1 backdrop-blur-sm"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">On this page</p>
          <ul className="flex flex-wrap gap-2">
            {PRIVACY_SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex items-center rounded-full border border-line bg-canvas/50 px-3 py-1.5 text-xs font-medium text-content transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {String(i + 1).padStart(2, "0")}. {s.title}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#data-disclosure"
                className="inline-flex items-center rounded-full border border-line bg-canvas/50 px-3 py-1.5 text-xs font-medium text-content transition-colors hover:border-primary/40 hover:text-primary"
              >
                {String(PRIVACY_SECTIONS.length + 1).padStart(2, "0")}. Data Disclosure
              </a>
            </li>
          </ul>
        </nav>

        <div className="space-y-6">
          {PRIVACY_SECTIONS.map((s, i) => (
            <SectionCard key={s.id} index={i + 1} section={s} />
          ))}

          {/* Section 10 — Google Play Data Disclosure */}
          <section
            id="data-disclosure"
            className="scroll-mt-24 rounded-3xl border border-line bg-surface/80 p-6 shadow-e1 backdrop-blur-sm sm:p-8"
          >
            <div className="flex items-start gap-4">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
              >
                <Database size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl font-bold text-content sm:text-2xl">
                  Data Disclosure
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
                  A plain-language summary of the data HOMEEIGO handles — what we collect, why,
                  whether it is shared, and how long we keep it. This mirrors the Google Play
                  Data safety disclosure for our mobile apps.
                </p>
                <div className="mt-5">
                  <DataDisclosureTable />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <LegalFooterNav current="/legal/privacy" />
    </main>
  );
}
