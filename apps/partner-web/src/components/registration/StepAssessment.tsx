"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerRegistrationApi, type AssessmentPayload, type AssessmentResult } from "@/services/partner-registration-api";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

export function StepAssessment({
  loading,
  onPassed,
}: {
  loading: boolean;
  onPassed: () => Promise<void>;
}) {
  const [pack, setPack] = useState<AssessmentPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const submitLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const data = await partnerRegistrationApi.getAssessment();
        if (!cancelled) setPack(data);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const answered = pack ? pack.questions.filter((q) => answers[q.id]).length : 0;

  async function submit() {
    if (!pack) return;
    if (pack.questions.some((q) => !answers[q.id])) {
      setError("Answer every question before submitting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scored = await partnerRegistrationApi.runAssessment({
        skillSlug: pack.skillSlug,
        answers,
      });
      setResult(scored);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!pack && error) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-partner-danger">{error}</p>
        <PartnerButton type="button" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
          Retry loading assessment
        </PartnerButton>
      </div>
    );
  }

  if (!pack && !error) {
    return (
      <div className="space-y-3">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-partner-line/50" />
        <div className="h-40 animate-pulse rounded-2xl bg-partner-line/40" />
      </div>
    );
  }

  if (result?.passed) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="text-lg font-semibold text-emerald-950">Assessment passed</h2>
              <p className="mt-1 text-sm text-emerald-800">
                Score {result.score}/{result.maxScore} · {result.correctCount} of {result.total} correct
              </p>
              <p className="mt-2 text-sm text-emerald-800/90">
                You can continue to training, then review and submit.
              </p>
            </div>
          </div>
        </div>
        <PartnerButton
          type="button"
          className="w-full"
          disabled={loading}
          onClick={() => {
            if (submitLock.current || loading) return;
            submitLock.current = true;
            void onPassed().finally(() => {
              submitLock.current = false;
            });
          }}
        >
          {loading ? "Continuing…" : "Continue to training"}
        </PartnerButton>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">Skill assessment</h2>
          <span className="rounded-full bg-partner-primary/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-partner-primary">
            {pack?.skillSlug}
          </span>
        </div>
        <p className="mt-1 text-sm text-partner-muted">
          Short professional quiz, scored by HOMEEIGO. You need {pack?.passScore ?? 60}% to continue.
        </p>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] font-semibold text-partner-muted">
            <span>
              {answered} of {pack?.questions.length ?? 0} answered
            </span>
            <span>Pass {pack?.passScore ?? 60}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-partner-line">
            <div
              className="h-full rounded-full bg-partner-primary transition-all"
              style={{
                width: `${pack?.questions.length ? Math.round((answered / pack.questions.length) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      </div>

      {result && !result.passed ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Score {result.score}/{result.maxScore}. You need {pack?.passScore ?? 60}% to pass. Review and retry.
        </div>
      ) : null}

      {pack?.questions.map((q, index) => (
        <fieldset key={q.id} className="rounded-2xl border border-partner-line bg-white/70 p-4">
          <legend className="text-sm font-semibold">
            {index + 1}. {q.prompt}
          </legend>
          <div className="mt-3 space-y-2">
            {q.options.map((opt) => {
              const selected = answers[q.id] === opt.id;
              return (
                <label
                  key={opt.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition",
                    selected
                      ? "border-partner-primary bg-partner-primary/10 font-medium"
                      : "border-partner-line hover:border-partner-primary/40",
                  )}
                >
                  <input
                    type="radio"
                    name={q.id}
                    value={opt.id}
                    checked={selected}
                    onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                    className="mt-0.5"
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {error ? (
        <p role="alert" className="text-sm text-partner-danger">
          {error}
        </p>
      ) : null}

      <PartnerButton type="button" className="w-full" disabled={busy} onClick={() => void submit()}>
        {busy ? "Scoring…" : result ? (
          <span className="inline-flex items-center gap-2">
            <RotateCcw className="h-4 w-4" /> Retry assessment
          </span>
        ) : (
          "Submit answers"
        )}
      </PartnerButton>
    </div>
  );
}
