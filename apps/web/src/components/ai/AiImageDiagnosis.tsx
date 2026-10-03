"use client";

import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { aiGlassPanel, aiSectionShell, aiSectionTitle } from "@/components/ai/ai-page-layout";

/**
 * This section previously "diagnosed" any uploaded photo with a hardcoded, fabricated
 * result ("possible AC airflow issue detected") after a fake 2.2s delay — no upload, no AI
 * call, same claim for every image. Real, certified photo-based AI analysis exists at
 * /vision (vision-intelligence.service.ts, SHADOW-only). Whether this section should call
 * that pipeline directly or simply link there is a product decision, not made here — this
 * is the smallest fix that stops presenting a fabricated finding as a real one: an honest
 * "coming soon" state, matching the project's standing convention for unbacked features.
 */
export function AiImageDiagnosis() {
  return (
    <section
      id={AI_SECTION_IDS.diagnosis}
      className={cn(aiSectionShell, "scroll-mt-24 p-3.5 sm:p-6 lg:p-8")}
    >
      <h2 className={aiSectionTitle}>AI Image Diagnosis</h2>

      <div
        className={cn(
          "ai-diagnosis-zone mt-3 flex h-[min(44vw,200px)] min-h-[168px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-400/20 opacity-70 sm:mt-4 sm:h-[220px] sm:gap-3 lg:h-[240px]",
          aiGlassPanel,
        )}
      >
        <Camera size={48} className="text-emerald-400/60" />
        <span className="font-display text-base font-bold tracking-tight text-ink">
          Photo diagnosis — coming soon
        </span>
        <span className="max-w-xs text-center text-[13px] text-slate">
          Upload-a-photo AI diagnosis isn&apos;t live here yet.
        </span>
      </div>
    </section>
  );
}
