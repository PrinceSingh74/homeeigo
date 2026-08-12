"use client";

import { Sparkles } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

type Props = {
  label?: string;
  className?: string;
  variant?: "button" | "link";
};

export function UpgradeCTA({ label = "Upgrade now", className, variant = "button" }: Props) {
  const openOverlay = useAppStore((s) => s.openOverlay);
  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={() => openOverlay("premium")}
        className={cn("text-sm font-semibold text-emerald-700 underline-offset-2 hover:underline", className)}
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openOverlay("premium")}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] px-4 py-2 text-sm font-bold text-white shadow-[0_8px_24px_-6px_rgb(16_185_129/0.5)] transition hover:opacity-95",
        className,
      )}
    >
      <Sparkles size={16} aria-hidden />
      {label}
    </button>
  );
}
