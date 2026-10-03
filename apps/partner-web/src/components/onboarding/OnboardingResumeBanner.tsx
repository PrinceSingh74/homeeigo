"use client";

import { CheckCircle2 } from "lucide-react";
import { formatLastSaved } from "@/lib/onboarding-resume";

export function OnboardingResumeBanner({
  percentComplete,
  resumeLabel,
  lastSavedAt,
}: {
  percentComplete: number;
  resumeLabel: string;
  lastSavedAt?: string | null;
}) {
  const saved = formatLastSaved(lastSavedAt);
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-4 py-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <div>
        <p className="text-sm font-semibold text-emerald-900">Progress restored</p>
        <p className="text-xs text-emerald-800/80">
          {percentComplete}% complete · Continue from {resumeLabel}
          {saved ? ` · ${saved}` : ""}
        </p>
      </div>
    </div>
  );
}
