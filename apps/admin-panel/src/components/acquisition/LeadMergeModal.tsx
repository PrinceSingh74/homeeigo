"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GlassModal } from "@/components/acquisition/GlassModal";
import { adminApi, type PartnerDuplicateMatch, type PartnerLeadMergeField } from "@/services/admin-api";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

export function LeadMergeModal({
  open,
  primaryId,
  candidate,
  onClose,
  onMerged,
}: {
  open: boolean;
  primaryId: string;
  candidate: PartnerDuplicateMatch | null;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, "primary" | "duplicate">>({});
  const preview = useQuery({
    queryKey: ["merge-preview", primaryId, candidate?.id],
    queryFn: () => adminApi.partnerAcquisition.previewMerge(primaryId, candidate!.id),
    enabled: open && Boolean(candidate?.id) && candidate?.type === "lead",
  });

  useEffect(() => {
    if (preview.data) {
      setResolutions(
        Object.fromEntries(preview.data.fields.map((f) => [f.key, f.suggested])) as Record<string, "primary" | "duplicate">,
      );
    }
  }, [preview.data]);

  const merge = useMutation({
    mutationFn: () =>
      adminApi.partnerAcquisition.mergeLeads(primaryId, {
        duplicateLeadId: candidate!.id,
        reason,
        resolutions,
      }),
    onSuccess: onMerged,
  });

  const mark = useMutation({
    mutationFn: () =>
      adminApi.partnerAcquisition.markDuplicate(candidate!.id, {
        duplicateOfLeadId: primaryId,
        reason,
      }),
    onSuccess: onMerged,
  });

  return (
    <GlassModal open={open} title="Duplicate management" subtitle="Mark duplicate or merge into the primary record. History is preserved." size="lg" onClose={onClose}>
      {!candidate ? (
        <p className="text-sm text-[var(--color-biz-muted)]">No candidate selected.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Possible duplicate: <strong>{candidate.name}</strong> · {candidate.phoneMasked} · {candidate.status}
            {candidate.city ? ` · ${candidate.city}` : ""}
          </p>
          {preview.data?.blocking.length ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {preview.data.blocking.join(" ")}
            </p>
          ) : null}
          <div className="max-h-[360px] space-y-2 overflow-y-auto">
            {(preview.data?.fields ?? []).map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={resolutions[field.key] ?? field.suggested}
                onChange={(v) => setResolutions((prev) => ({ ...prev, [field.key]: v }))}
              />
            ))}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-biz-line)] px-3 py-2 text-sm"
              rows={2}
              required
            />
          </label>
          {merge.error || mark.error ? (
            <p role="alert" className="text-sm text-rose-700">
              {getErrorMessage(merge.error ?? mark.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {candidate.type === "lead" ? (
              <button
                type="button"
                disabled={!reason.trim() || Boolean(preview.data?.blocking.length) || merge.isPending}
                onClick={() => merge.mutate()}
                className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-[#05070d] disabled:opacity-50"
              >
                {merge.isPending ? "Merging…" : "Merge records"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!reason.trim() || mark.isPending}
              onClick={() => mark.mutate()}
              className="rounded-xl border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
            >
              Mark duplicate
            </button>
            {candidate.type === "lead" ? (
              <a href={`/partner-acquisition/leads/${candidate.id}`} className="rounded-xl px-4 py-2 text-sm font-semibold">
                View existing
              </a>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </GlassModal>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: PartnerLeadMergeField;
  value: "primary" | "duplicate";
  onChange: (v: "primary" | "duplicate") => void;
}) {
  return (
    <div className={cn("rounded-xl border px-3 py-2 text-xs", field.conflict ? "border-amber-300 bg-amber-50" : "border-[var(--color-biz-line)]")}>
      <div className="mb-1 flex justify-between font-semibold">
        <span>{field.label}</span>
        <span className="text-[var(--color-biz-muted)]">{field.shared ? "Shared" : field.conflict ? "Conflict" : "Fill from one side"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onChange("primary")} className={cn("rounded-lg border px-2 py-1.5 text-left", value === "primary" && "border-[var(--color-biz-accent)] bg-[var(--color-biz-elevated)]")}>
          Primary: {field.primaryValue || "—"}
        </button>
        <button type="button" onClick={() => onChange("duplicate")} className={cn("rounded-lg border px-2 py-1.5 text-left", value === "duplicate" && "border-[var(--color-biz-accent)] bg-[var(--color-biz-elevated)]")}>
          Duplicate: {field.duplicateValue || "—"}
        </button>
      </div>
    </div>
  );
}
