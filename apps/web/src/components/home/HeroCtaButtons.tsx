"use client";

import { ArrowRight, Play } from "lucide-react";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { bookUrl } from "@/lib/booking-url";
import { useAppStore } from "@/stores/app-store";

export function HeroCtaButtons() {
  const openOverlay = useAppStore((s) => s.openOverlay);
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <ButtonLink
        href={bookUrl()}
        variant="primary"
        className="group !bg-[linear-gradient(120deg,#10b981_0%,#0d9488_55%,#14b8a6_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_8px_24px_-6px_rgb(16_185_129/0.5)] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_14px_36px_-8px_rgb(16_185_129/0.6)]"
      >
        Book a Service
        <ArrowRight
          size={20}
          className="transition-transform group-hover:translate-x-1"
        />
      </ButtonLink>
      <button
        type="button"
        onClick={() => openOverlay("how-it-works")}
        className="relative inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-surface/70 px-7 text-base font-semibold text-emerald-700 shadow-e2 backdrop-blur-md transition hover:-translate-y-1 hover:border-emerald-500/40 dark:text-emerald-300"
      >
        <Play size={18} />
        See How It Works
      </button>
    </div>
  );
}
