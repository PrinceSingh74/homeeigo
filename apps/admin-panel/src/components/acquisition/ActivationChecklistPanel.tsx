"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Circle,
  FileCheck2,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { adminApi, type PartnerActivationChecklist } from "@/services/admin-api";
import { cn } from "@/lib/cn";

const CATEGORY_ICON = {
  profile: UserRound,
  kyc: ShieldCheck,
  documents: FileCheck2,
  verification: BadgeCheck,
  training: BookOpen,
  assessment: Sparkles,
} as const;

const CHANGE_STEP_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "skills", label: "Skills" },
  { id: "location", label: "Location" },
  { id: "availability", label: "Availability" },
  { id: "kyc", label: "KYC" },
  { id: "documents", label: "Documents" },
  { id: "background", label: "Background verification" },
  { id: "assessment", label: "Skill assessment" },
  { id: "training", label: "Training" },
];

type ActivationChecklistPanelProps = {
  providerId: string;
  providerName: string;
  isApproved: boolean;
  checklist?: PartnerActivationChecklist;
  isLoading?: boolean;
  onRefresh?: () => void;
  /** Compact layout for inspect dock / side panels */
  compact?: boolean;
};

export function ActivationChecklistPanel({
  providerId,
  providerName,
  isApproved,
  checklist,
  isLoading,
  onRefresh,
  compact = false,
}: ActivationChecklistPanelProps) {
  const qc = useQueryClient();
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [changeNotes, setChangeNotes] = useState("");
  const [targetStep, setTargetStep] = useState("");
  const [changeError, setChangeError] = useState<string | null>(null);

  const verifyBg = useMutation({
    mutationFn: () => adminApi.partnerAcquisition.verifyBackgroundCheck(providerId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "activation-checklist", providerId] });
      onRefresh?.();
    },
  });

  const requestChanges = useMutation({
    mutationFn: () =>
      adminApi.verifyProvider(
        providerId,
        "request_changes",
        changeNotes.trim(),
        targetStep || checklist?.suggestedChangeStep,
      ),
    onSuccess: async () => {
      setShowRequestChanges(false);
      setChangeNotes("");
      setChangeError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "activation-checklist", providerId] });
      await qc.invalidateQueries({ queryKey: ["admin", "providers"] });
      onRefresh?.();
    },
    onError: (err: Error) => {
      setChangeError(err.message);
    },
  });

  if (isLoading) {
    return (
      <GlassPanel className="p-5">
        <div className="space-y-3">
          <div className="h-6 w-48 animate-pulse rounded bg-[var(--color-biz-elevated)]" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--color-biz-elevated)]" />
          ))}
        </div>
      </GlassPanel>
    );
  }

  if (!checklist) return null;

  const ready = checklist.ready;
  const suggestedStep = checklist.suggestedChangeStep ?? "";
  const suggestedLabel = checklist.suggestedChangeStepLabel ?? "the missing step";

  return (
    <GlassPanel
      className={cn(
        "overflow-hidden p-0",
        ready ? "ring-1 ring-emerald-500/25" : "ring-1 ring-amber-500/20",
        compact && "max-h-[min(420px,50vh)] overflow-y-auto",
      )}
    >
      <div className={cn("border-b border-[var(--color-biz-line)]", compact ? "px-3 py-3" : "px-5 py-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {!compact ? (
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-biz-muted)]">
                Approval workspace
              </p>
            ) : null}
            <h2 className={cn("font-display font-bold tracking-tight", compact ? "text-sm" : "mt-1 text-lg")}>
              {ready ? "Ready for activation" : "Activation checklist"}
            </h2>
            <p className={cn("text-[var(--color-biz-muted)]", compact ? "mt-0.5 text-xs" : "mt-1 text-sm")}>
              {checklist.completedCount}/{checklist.totalCount} requirements met
              {checklist.requiredModules > 0
                ? ` · Training ${checklist.completedModules}/${checklist.requiredModules}`
                : ""}
            </p>
          </div>
          <div
            className={cn(
              "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide",
              ready
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-amber-500/15 text-amber-400",
            )}
          >
            {checklist.progressPercent}%
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-biz-elevated)]">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              ready ? "bg-emerald-500" : "bg-[var(--color-biz-accent)]",
            )}
            style={{ width: `${checklist.progressPercent}%` }}
          />
        </div>
      </div>

      {!ready && !isApproved && !compact ? (
        <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/10 px-5 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Partner activation is blocked until all checklist items are complete.
            {checklist.missingLabels.length ? ` Missing: ${checklist.missingLabels.join(", ")}.` : ""}
            {suggestedLabel ? (
              <>
                {" "}
                Request changes will return the applicant to{" "}
                <span className="font-semibold text-amber-100">{suggestedLabel}</span>.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className={cn("space-y-2", compact ? "p-3" : "p-5")}>
        {checklist.items.map((item) => {
          const Icon = CATEGORY_ICON[item.category as keyof typeof CATEGORY_ICON] ?? Circle;
          return (
            <div
              key={item.key}
              className={cn(
                "flex items-start gap-3 rounded-xl border transition",
                compact ? "px-3 py-2" : "px-4 py-3",
                item.complete
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/40",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex shrink-0 items-center justify-center rounded-lg",
                  compact ? "h-6 w-6" : "h-8 w-8",
                  item.complete ? "bg-emerald-500/15 text-emerald-400" : "bg-[var(--color-biz-surface)] text-[var(--color-biz-muted)]",
                )}
              >
                {item.complete ? <CheckCircle2 className={compact ? "h-3 w-3" : "h-4 w-4"} /> : <Icon className={compact ? "h-3 w-3" : "h-4 w-4"} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>{item.label}</p>
                {!compact ? <p className="text-xs text-[var(--color-biz-muted)]">{item.description}</p> : null}
                {!item.complete && item.key === "documentsVerified" ? (
                  <Link
                    href="/vendors/documents"
                    className="mt-1 inline-block text-xs font-semibold text-[var(--color-biz-accent)]"
                  >
                    Open document verification →
                  </Link>
                ) : null}
                {!item.complete && item.key === "trainingComplete" ? (
                  <Link href="/academy" className="mt-1 inline-block text-xs font-semibold text-[var(--color-biz-accent)]">
                    Open Academy →
                  </Link>
                ) : null}
                {!item.complete && item.key === "backgroundCheckComplete" && !isApproved ? (
                  <button
                    type="button"
                    disabled={verifyBg.isPending}
                    onClick={() => verifyBg.mutate()}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[var(--color-biz-accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {verifyBg.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Mark background verified
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {!ready && !isApproved && !compact ? (
        <div className="border-t border-[var(--color-biz-line)] px-5 py-4">
          {!showRequestChanges ? (
            <button
              type="button"
              onClick={() => {
                setTargetStep(suggestedStep);
                setShowRequestChanges(true);
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-biz-accent)]/40 bg-[var(--color-biz-accent)]/10 px-4 py-3 text-sm font-semibold text-[var(--color-biz-accent)] transition hover:bg-[var(--color-biz-accent)]/15"
            >
              <RotateCcw className="h-4 w-4" />
              Request changes — send back to {suggestedLabel}
            </button>
          ) : (
            <div className="space-y-3 rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/40 p-4">
              <div>
                <p className="text-sm font-semibold">Request changes</p>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  {providerName} will be returned to the selected onboarding step. Their session stays
                  active — no hard rejection.
                </p>
              </div>
              <label className="block text-xs font-semibold text-[var(--color-biz-muted)]">
                Return to step
                <select
                  value={targetStep || suggestedStep}
                  onChange={(e) => setTargetStep(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-3 py-2 text-sm"
                >
                  {CHANGE_STEP_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                      {opt.id === suggestedStep ? " (suggested)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-[var(--color-biz-muted)]">
                Instructions for applicant
                <textarea
                  value={changeNotes}
                  onChange={(e) => setChangeNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. Upload a clearer PAN photo and verify bank account name matches Aadhaar."
                  className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-3 py-2 text-sm"
                />
              </label>
              {changeError ? (
                <p className="text-xs text-red-400">{changeError}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={requestChanges.isPending || changeNotes.trim().length < 8}
                  onClick={() => requestChanges.mutate()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {requestChanges.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Send back for updates
                </button>
                <button
                  type="button"
                  disabled={requestChanges.isPending}
                  onClick={() => {
                    setShowRequestChanges(false);
                    setChangeError(null);
                  }}
                  className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold text-[var(--color-biz-muted)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {ready && !isApproved ? (
        <div className="border-t border-[var(--color-biz-line)] bg-emerald-500/5 px-5 py-4 text-sm text-emerald-300">
          {providerName} meets all activation requirements. You can approve this partner.
        </div>
      ) : null}
    </GlassPanel>
  );
}
