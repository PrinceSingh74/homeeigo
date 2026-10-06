"use client";

import { Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { aiGlassPanel, aiSection, aiSectionTitle, aiStatusShell } from "@/components/ai/ai-page-layout";

/**
 * This section used to show a "Home Status Overview" — overall health 95%, 6/6 systems online, AC
 * efficiency 92%, an energy bill, water and safety readings, "updated just now" — as live telemetry
 * for the customer's home. Nothing measures any of it: the cards were constants, identical for
 * every customer. Home monitoring has no backend, so, following the project's standing convention
 * for unbacked features (see AiImageDiagnosis), the section says it is not available yet.
 */
export function AiHomeStatusSection() {
  return (
    <section
      id={AI_SECTION_IDS.homeStatus}
      className={cn(aiSection, "scroll-mt-24")}
      aria-labelledby="home-status-heading"
    >
      <div className={aiStatusShell}>
        <h2 id="home-status-heading" className={aiSectionTitle}>
          Home Status
        </h2>
        <div
          className={cn(
            "mt-3 flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-400/20 p-6 text-center opacity-80 sm:mt-4",
            aiGlassPanel,
          )}
        >
          <Home size={40} className="text-emerald-400/60" />
          <span className="font-display text-base font-bold tracking-tight text-ink">
            Home monitoring — coming soon
          </span>
          <span className="max-w-sm text-[13px] text-slate">
            Readings for your home&apos;s cleaning, cooling, energy, water and safety aren&apos;t available here yet.
          </span>
        </div>
      </div>
    </section>
  );
}
