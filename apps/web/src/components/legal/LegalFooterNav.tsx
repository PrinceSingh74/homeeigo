import Link from "next/link";
import { ArrowLeft, ArrowRight, Home, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEGAL_ENTITY, LEGAL_EMAIL } from "@/lib/legal/legal-data";
import { LEGAL_DOCS, LEGAL_HOME } from "@/lib/legal/legal-docs";

/** Cross-links, contact and a route back to the product, shared by every legal page. */
export function LegalFooterNav({ current }: { current?: string }) {
  const index = current ? LEGAL_DOCS.findIndex((doc) => doc.href === current) : -1;
  const prev = index > 0 ? LEGAL_DOCS[index - 1] : null;
  const next = index >= 0 && index < LEGAL_DOCS.length - 1 ? LEGAL_DOCS[index + 1] : null;

  return (
    <footer className="border-t border-line bg-surface/40 print:hidden">
      <div className="mx-auto max-w-[90rem] px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        {prev || next ? (
          <nav
            aria-label="Adjacent legal documents"
            className="mb-10 grid gap-3 sm:grid-cols-2"
          >
            {prev ? (
              <Link
                href={prev.href}
                className="group flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-e1 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <ArrowLeft
                  size={16}
                  aria-hidden
                  className="shrink-0 text-muted transition-transform group-hover:-translate-x-0.5 group-hover:text-legal-accent"
                />
                <span className="min-w-0">
                  <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted">
                    Previous
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-semibold text-content group-hover:text-legal-accent">
                    {prev.label}
                  </span>
                </span>
              </Link>
            ) : (
              <span className="hidden sm:block" />
            )}
            {next ? (
              <Link
                href={next.href}
                className="group flex min-h-11 items-center justify-end gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-right shadow-e1 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span className="min-w-0">
                  <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted">
                    Next
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-semibold text-content group-hover:text-legal-accent">
                    {next.label}
                  </span>
                </span>
                <ArrowRight
                  size={16}
                  aria-hidden
                  className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-legal-accent"
                />
              </Link>
            ) : null}
          </nav>
        ) : null}

        <nav aria-label="Legal documents">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            More legal documents
          </p>
          <ul className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            {LEGAL_DOCS.map((doc) => {
              const active = doc.href === current;
              return (
                <li key={doc.href}>
                  <Link
                    href={doc.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex min-h-11 items-center gap-1.5 rounded-md text-[0.9375rem] font-semibold outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                      active ? "text-legal-accent" : "text-content hover:text-legal-accent",
                    )}
                  >
                    {doc.label}
                    {active ? (
                      <span className="text-xs font-medium text-muted">(current)</span>
                    ) : (
                      <ArrowRight
                        size={14}
                        aria-hidden
                        className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-legal-accent"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-8 flex flex-col gap-6 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-base font-bold tracking-tight text-content">HOMEEIGO</p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
              {LEGAL_ENTITY} · Premium home services, made with care in India.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href={`mailto:${LEGAL_EMAIL}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-content shadow-e1 outline-none transition-colors hover:border-primary/40 hover:text-legal-accent focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <Mail size={16} aria-hidden />
              {LEGAL_EMAIL}
            </a>
            <Link
              href={LEGAL_HOME}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted outline-none transition-colors hover:text-content focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Legal
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted outline-none transition-colors hover:text-content focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <Home size={15} aria-hidden />
              Back to HOMEEIGO
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
