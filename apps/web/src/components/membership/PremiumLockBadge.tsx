"use client";

import { Crown, Lock } from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

type Props = {
  premiumOnly?: boolean;
  className?: string;
  showUpgradeCta?: boolean;
};

/** Shows premium lock or active badge based on server entitlements. */
export function PremiumLockBadge({ premiumOnly, className, showUpgradeCta = true }: Props) {
  const openOverlay = useAppStore((s) => s.openOverlay);
  const { data: entitlements } = useEntitlements();

  if (!premiumOnly) return null;

  const unlocked = entitlements?.premiumAccess;

  if (unlocked) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300",
          className,
        )}
      >
        <Crown size={11} aria-hidden />
        Premium
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => showUpgradeCta && openOverlay("premium")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-slate-900/10 px-2 py-0.5 text-[10px] font-semibold text-muted transition hover:bg-emerald-500/10 hover:text-emerald-700 dark:bg-white/10",
        className,
      )}
    >
      <Lock size={11} aria-hidden />
      {showUpgradeCta ? "Upgrade to unlock" : "Premium only"}
    </button>
  );
}
