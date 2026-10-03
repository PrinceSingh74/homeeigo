"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerRegistrationApi, type OnboardingReviewPayload } from "@/services/partner-registration-api";
import { getErrorMessage } from "@/lib/api-error";
import type { WebOnboardingStep } from "@/lib/onboarding-resume";

const EDIT_STEP: Record<string, WebOnboardingStep> = {
  profile: "profile",
  services: "services",
  location: "location",
  availability: "availability",
  kyc: "kyc",
  documents: "documents",
  assessment: "assessment",
  training: "training",
};

export function StepReview({
  loading,
  onEdit,
  onSubmit,
}: {
  loading: boolean;
  onEdit: (step: WebOnboardingStep) => void;
  onSubmit: () => Promise<void>;
}) {
  const [data, setData] = useState<OnboardingReviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    partnerRegistrationApi
      .getReview()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data && !error) {
    return <div className="h-48 animate-pulse rounded-2xl bg-partner-line/40" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Final review</h2>
        <p className="mt-1 text-sm text-partner-muted">Confirm your application before HQ review. Backend still decides readiness.</p>
      </div>

      <div className="space-y-3">
        {(data?.sections ?? []).map((section) => (
          <div key={section.id} className="flex items-start justify-between gap-3 rounded-2xl border border-partner-line bg-white/80 px-4 py-3">
            <div className="flex items-start gap-3">
              {section.complete ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 text-partner-muted" />
              )}
              <div>
                <p className="font-semibold">{section.label}</p>
                <p className="text-sm text-partner-muted">{section.summary || (section.complete ? "Complete" : "Incomplete")}</p>
              </div>
            </div>
            {EDIT_STEP[section.id] ? (
              <button
                type="button"
                className="text-sm font-semibold text-partner-primary"
                onClick={() => onEdit(EDIT_STEP[section.id]!)}
              >
                {section.id === "assessment" || section.id === "training" ? "View" : "Edit"}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {data && !data.canSubmit ? (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {data.submitBlockers.join(" ")}
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-partner-danger">{error}</p> : null}

      <PartnerButton type="button" className="w-full" disabled={loading || !data?.canSubmit} onClick={() => void onSubmit()}>
        {loading ? "Submitting…" : "Submit application"}
      </PartnerButton>
    </div>
  );
}
