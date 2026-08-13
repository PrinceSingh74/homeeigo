import Link from "next/link";
import { cn } from "@/lib/utils";
import { LEGAL_DOCS } from "@/lib/legal/legal-docs";

/**
 * Document switcher for the Legal Center.
 *
 * Two presentations of the same list: a sticky rail on desktop, a horizontal
 * pill row on smaller screens. Labels come from the document registry — nothing
 * here restates a policy clause.
 */
export function LegalNav({
  current,
  variant,
}: {
  current?: string;
  variant: "rail" | "pills";
}) {
  if (variant === "pills") {
    return (
      <nav
        aria-label="Legal documents"
        className="border-b border-line bg-canvas/80 print:hidden lg:hidden"
      >
        <ul className="scrollbar-none mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2.5 sm:px-6">
          {LEGAL_DOCS.map((doc) => {
            const active = doc.href === current;
            return (
              <li key={doc.href} className="shrink-0">
                <Link
                  href={doc.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={doc.label}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                    active
                      ? "bg-primary/10 text-legal-accent"
                      : "text-muted hover:bg-surface hover:text-content",
                  )}
                >
                  {doc.shortLabel}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Legal documents" className="sticky top-[4.75rem] print:hidden">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Documents
      </p>
      <ul className="mt-3 border-l border-line">
        {LEGAL_DOCS.map((doc) => {
          const active = doc.href === current;
          return (
            <li key={doc.href}>
              <Link
                href={doc.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-ml-px flex border-l-2 py-2 pl-3.5 pr-2 text-sm outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-primary/60",
                  active
                    ? "border-legal-accent font-semibold text-legal-accent"
                    : "border-transparent text-muted hover:border-line hover:text-content",
                )}
              >
                {doc.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
