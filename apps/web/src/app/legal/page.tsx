import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { LegalNav } from "@/components/legal/LegalNav";
import { LEGAL_DOCS } from "@/lib/legal/legal-docs";
import { LEGAL_EFFECTIVE, LEGAL_ENTITY } from "@/lib/legal/legal-data";

export const metadata: Metadata = {
  title: "Legal",
  description:
    "HOMEEIGO Privacy Policy, Terms of Service, Cookie Preferences and Refund Policy.",
  alternates: { canonical: "/legal" },
  openGraph: {
    title: "HOMEEIGO Legal",
    description: "HOMEEIGO Privacy Policy, Terms of Service, Cookie Preferences and Refund Policy.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

/**
 * Legal Center index. `/legal` previously had no page even though the footer,
 * sitemap and breadcrumbs all imply a hub, so the bare route 404'd.
 *
 * Navigation only: every row reuses the document's own title and lead line
 * from the registry, so no policy wording originates here.
 */
export default function LegalCenterPage() {
  return (
    <main>
      <div className="mx-auto max-w-[90rem] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,42rem)] lg:items-start lg:justify-center lg:gap-12">
          <aside className="hidden lg:block">
            <LegalNav variant="rail" />
          </aside>

          <div id="legal-content" className="min-w-0">
            <header className="max-w-[42rem]">
              <h1 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-[1.12] tracking-tight text-content">
                Legal
              </h1>
              <span aria-hidden className="legal-title-rule mt-4 block" />
              <p className="mt-5 text-sm font-medium text-muted">
                {LEGAL_ENTITY} · Effective{" "}
                <time dateTime={LEGAL_EFFECTIVE}>{LEGAL_EFFECTIVE}</time>
              </p>
            </header>

            <h2 className="sr-only">Policy documents</h2>
            <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-e1 sm:mt-10">
              {LEGAL_DOCS.map((doc, i) => (
                <li key={doc.href}>
                  <Link
                    href={doc.href}
                    className="group flex items-start gap-4 px-5 py-5 outline-none transition-colors hover:bg-canvas/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 sm:gap-5 sm:px-7 sm:py-6"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-legal-accent"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-display text-base font-bold tracking-tight text-content sm:text-lg">
                          {doc.label}
                        </span>
                        <ArrowRight
                          size={16}
                          aria-hidden
                          className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-legal-accent"
                        />
                      </span>
                      <span className="mt-1.5 block text-[0.9375rem] leading-relaxed text-muted">
                        {doc.subtitle}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <LegalFooterNav />
    </main>
  );
}
