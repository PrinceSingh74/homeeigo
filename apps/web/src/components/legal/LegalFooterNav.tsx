import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { LEGAL_ENTITY, LEGAL_EMAIL } from "@/lib/legal/legal-data";

const LINKS = [
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/cookies", label: "Cookie Preferences" },
  { href: "/legal/refund", label: "Refund Policy" },
];

/** Consistent cross-links + contact block shared across all legal pages. */
export function LegalFooterNav({ current }: { current?: string }) {
  return (
    <footer className="mx-auto mt-16 max-w-3xl border-t border-line px-4 py-10 sm:px-6">
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <p className="font-display text-base font-bold text-content">HOMEEIGO</p>
          <p className="mt-1 text-xs text-muted">
            {LEGAL_ENTITY} · Premium home services, made with care in India.
          </p>
        </div>
        <a
          href={`mailto:${LEGAL_EMAIL}`}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-content shadow-e1 transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Mail size={16} aria-hidden />
          {LEGAL_EMAIL}
        </a>
      </div>

      <nav className="mt-8 flex flex-wrap gap-2.5" aria-label="Legal pages">
        {LINKS.map((l) => {
          const active = l.href === current;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white"
                  : "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-content transition-colors hover:border-primary/40 hover:text-primary"
              }
            >
              {l.label}
              {!active ? <ArrowRight size={13} aria-hidden /> : null}
            </Link>
          );
        })}
      </nav>
    </footer>
  );
}
