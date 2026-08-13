"use client";

import { useMemo, useState } from "react";
import { Clock, List, Printer, Search } from "lucide-react";
import { LegalDocument, type LegalTocItem } from "@/components/legal/LegalDocument";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { LegalSection } from "@/components/legal/LegalSection";
import { TERMS_SECTIONS } from "@/lib/legal/legal-data";
import { getLegalDoc } from "@/lib/legal/legal-docs";

const DOC = getLegalDoc("terms");
const WPM = 200;

const ALL_TOC: readonly LegalTocItem[] = TERMS_SECTIONS.map((section) => ({
  id: section.id,
  title: section.title,
}));

/** Deterministic at module scope, so server and client agree on first paint. */
const READING_TIME = Math.max(
  1,
  Math.round(
    TERMS_SECTIONS.reduce(
      (words, section) =>
        words + section.title.split(/\s+/).length + section.body.split(/\s+/).length,
      0,
    ) / WPM,
  ),
);

const metaPill =
  "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[0.8125rem] font-medium text-content shadow-e1";

export function TermsReader() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  /**
   * Search narrows the contents list only — every clause stays rendered. A
   * legal agreement should never be silently shown in part because of a filter.
   */
  const toc = useMemo(() => {
    if (!q) return ALL_TOC;
    return TERMS_SECTIONS.filter(
      (section) =>
        section.title.toLowerCase().includes(q) || section.body.toLowerCase().includes(q),
    ).map((section) => ({ id: section.id, title: section.title }));
  }, [q]);

  return (
    <main>
      <LegalDocument
        doc={DOC}
        toc={toc}
        header={
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <span className={metaPill}>
                <Clock size={14} className="text-legal-accent" aria-hidden />
                {READING_TIME} min read
              </span>
              <span className={metaPill}>
                <List size={14} className="text-legal-accent" aria-hidden />
                {TERMS_SECTIONS.length} sections
              </span>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.8125rem] font-medium text-content shadow-e1 outline-none transition-colors hover:border-primary/40 hover:text-legal-accent focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:min-h-0 sm:py-1.5"
              >
                <Printer size={14} aria-hidden />
                Print
              </button>
            </div>

            <div className="print:hidden">
              <label htmlFor="terms-search" className="sr-only">
                Filter the contents list by clause
              </label>
              <div className="relative max-w-sm">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <input
                  id="terms-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Jump to a clause…"
                  aria-describedby="terms-search-status"
                  className="min-h-11 w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-content shadow-e1 outline-none transition-colors placeholder:text-muted focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
                />
              </div>
              <p
                id="terms-search-status"
                aria-live="polite"
                className="mt-2 min-h-5 text-xs text-muted"
              >
                {q
                  ? `${toc.length} of ${TERMS_SECTIONS.length} clauses match “${query}”. The full agreement stays below.`
                  : ""}
              </p>
            </div>
          </div>
        }
        footer={<LegalFooterNav current={DOC.href} />}
      >
        {TERMS_SECTIONS.map((section, i) => (
          <LegalSection key={section.id} id={section.id} index={i + 1} title={section.title}>
            <p>{section.body}</p>
          </LegalSection>
        ))}
      </LegalDocument>
    </main>
  );
}
