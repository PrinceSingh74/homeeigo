import type { ReactNode } from "react";
import { Lock, CreditCard, ShieldCheck, Globe, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { heroTitle } from "@/lib/page-layout";
import type { TrustBadge } from "@/lib/legal/legal-data";
import { LEGAL_EFFECTIVE } from "@/lib/legal/legal-data";

const ICONS: Record<TrustBadge["icon"], LucideIcon> = {
  lock: Lock,
  card: CreditCard,
  shield: ShieldCheck,
  globe: Globe,
  trash: Trash2,
};

/**
 * Shared trust-first hero for every legal / compliance page. Presentational
 * (no client hooks) so it renders on the server for the Privacy page and is
 * cheaply bundled by the client Terms / Cookie pages.
 */
export function LegalHero({
  eyebrow = "Legal & Compliance",
  title,
  subtitle,
  badges,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  badges?: TrustBadge[];
  children?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden">
      {/* Ambient premium backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 hero-grid opacity-60" />
        <div className="absolute -right-24 -top-28 size-[34rem] rounded-full bg-[radial-gradient(closest-side,rgb(37_99_235/0.16),transparent)]" />
        <div className="absolute -left-28 top-10 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgb(124_58_237/0.13),transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-canvas" />
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-10 pt-14 text-center sm:px-6 sm:pb-14 sm:pt-20">
        <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-surface/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary shadow-e1 backdrop-blur-md">
          <ShieldCheck size={14} aria-hidden />
          {eyebrow}
        </p>
        <h1 className={cn(heroTitle, "mx-auto mt-5 max-w-2xl")}>{title}</h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          {subtitle}
        </p>
        <p className="mt-4 text-xs font-medium text-muted">
          Effective {LEGAL_EFFECTIVE} · Last reviewed {LEGAL_EFFECTIVE}
        </p>

        {badges?.length ? (
          <ul className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-2.5">
            {badges.map((b) => {
              const Icon = ICONS[b.icon];
              return (
                <li
                  key={b.label}
                  className="inline-flex items-center gap-2 rounded-full border border-line/60 bg-surface/70 px-3.5 py-2 text-sm font-medium text-content shadow-e1 backdrop-blur-md"
                >
                  <Icon size={15} className="text-success" aria-hidden />
                  {b.label}
                </li>
              );
            })}
          </ul>
        ) : null}

        {children}
      </div>
    </header>
  );
}
