import { CreditCard, Globe, Lock, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import type { TrustBadge } from "@/lib/legal/legal-data";

const ICONS: Record<TrustBadge["icon"], LucideIcon> = {
  lock: Lock,
  card: CreditCard,
  shield: ShieldCheck,
  globe: Globe,
  trash: Trash2,
};

/** Compliance assurances shown under a document title. Presentational only. */
export function LegalTrustBadges({ badges }: { badges: readonly TrustBadge[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-2">
      {badges.map((badge) => {
        const Icon = ICONS[badge.icon];
        return (
          <li
            key={badge.label}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[0.8125rem] font-medium text-emerald-800 shadow-e1 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
          >
            <Icon size={14} className="text-emerald-600 dark:text-emerald-300" aria-hidden />
            {badge.label}
          </li>
        );
      })}
    </ul>
  );
}
