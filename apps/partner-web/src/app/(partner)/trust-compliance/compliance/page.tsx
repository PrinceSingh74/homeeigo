"use client";

import { FileCheck2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { partnerOsKeys, usePartnerComplianceQuery } from "@/hooks/use-partner-os";
import { partnerApi } from "@/services/partner-api";

function tone(state?: string) {
  if (state === "EXPIRED" || state === "RESTRICTED") return "text-red-700";
  if (state === "EXPIRING_URGENT" || state === "EXPIRING_SOON") return "text-amber-700";
  if (state === "VALID") return "text-emerald-700";
  return "text-partner-muted";
}

export default function ComplianceDetailsPage() {
  const compliance = usePartnerComplianceQuery();
  const qc = useQueryClient();
  const docs = compliance.data?.documents ?? [];
  const loading = compliance.isLoading && !compliance.data;
  const error =
    compliance.isError && !compliance.data
      ? compliance.error instanceof Error
        ? compliance.error.message
        : "Documents could not be loaded."
      : null;
  const save = useMutation({
    mutationFn: (input: { id: string; expiryDate: string }) =>
      partnerApi.partnerOs.setDocumentMeta(input.id, { expiryDate: input.expiryDate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: partnerOsKeys.compliance }),
  });

  return (
    <HqPageShell
      title="Documents & expiry"
      description="Expiry windows come from the backend. Set an expiry date so reminders can run."
      icon={FileCheck2}
      loading={loading}
      error={error}
      onRetry={() => void compliance.refetch()}
    >
      <section className="space-y-2">
        {docs.length === 0 ? (
          <p className="partner-card p-5 text-sm text-partner-muted">No documents uploaded yet.</p>
        ) : (
          docs.map((doc) => (
            <article key={doc.id} className="partner-card space-y-3 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{doc.documentName ?? doc.documentType}</p>
                  <p className={tone(doc.expiryState)}>
                    {doc.expiryState?.replace(/_/g, " ") ??
                      (doc.expiringSoon ? "Expiring" : doc.isVerified ? "Verified" : "Pending")}
                    {doc.daysToExpiry != null ? ` · ${doc.daysToExpiry} days` : ""}
                  </p>
                </div>
              </div>
              <label className="block text-xs font-medium text-partner-muted">
                Expiry date
                <input
                  type="date"
                  className="mt-1 min-h-11 w-full rounded-lg border border-partner-line px-3 text-sm text-partner-ink sm:w-auto"
                  defaultValue={doc.expiryDate ? String(doc.expiryDate).slice(0, 10) : ""}
                  aria-label={`Expiry date for ${doc.documentName ?? doc.documentType}`}
                  onBlur={(e) => {
                    if (e.target.value) save.mutate({ id: doc.id, expiryDate: e.target.value });
                  }}
                />
              </label>
              {save.isError ? (
                <p className="text-xs text-red-700" role="alert">
                  Could not save expiry. Try again.
                </p>
              ) : null}
            </article>
          ))
        )}
      </section>
    </HqPageShell>
  );
}
