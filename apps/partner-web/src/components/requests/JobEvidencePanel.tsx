"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Upload } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { partnerApi } from "@/services/partner-api";
import { getErrorMessage } from "@/lib/api-error";
import { formatDate, formatTime } from "@/lib/format";
import { fileToDataUrl } from "@/lib/file-to-data-url";
import { isApiMediaPath, openEvidenceMedia } from "@/lib/evidence-media";
import type { JobEvidenceItem } from "@/types/partner";

const STAGES = ["ARRIVAL", "START", "COMPLETION"] as const;

function evidencePreviewUrl(item: JobEvidenceItem): string | null {
  return item.mediaAccessUrl ?? item.mediaUrl ?? null;
}

/**
 * Job evidence by stage (ARRIVAL / START / COMPLETION).
 * Customer confirmation: OPTIONAL — Homigo does not require a separate customer
 * confirmation artifact at completion; customers rate post-job via Rating.
 * Do not fake confirmation evidence.
 */
export function JobEvidencePanel({
  bookingId,
  embedded = false,
}: {
  bookingId: string;
  /** Rendered inside the execution brief's "Proof" section: no card of its own, no second title. */
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const [uploadError, setUploadError] = useState<string | null>(null);

  const evidenceQuery = useQuery({
    queryKey: ["partner", "job-evidence", bookingId],
    queryFn: () => partnerApi.listEvidence(bookingId),
  });

  const uploadMutation = useMutation({
    mutationFn: (mediaUrl: string) =>
      partnerApi.uploadEvidence(bookingId, {
        stage: "COMPLETION",
        mediaUrl,
        clientUploadId: `web-${Date.now()}`,
        replace: true,
      }),
    onSuccess: () => {
      setUploadError(null);
      void qc.invalidateQueries({ queryKey: ["partner", "job-evidence", bookingId] });
    },
    onError: (err) => setUploadError(getErrorMessage(err)),
  });

  const byStage = useMemo(() => {
    const rows = evidenceQuery.data?.evidence ?? [];
    const map: Record<string, JobEvidenceItem[]> = {
      ARRIVAL: [],
      START: [],
      COMPLETION: [],
    };
    for (const row of rows) {
      const key = String(row.stage).toUpperCase();
      if (!map[key]) map[key] = [];
      map[key].push(row);
    }
    return map;
  }, [evidenceQuery.data?.evidence]);

  async function onFileChange(file: File | null) {
    if (!file) return;
    setUploadError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await uploadMutation.mutateAsync(dataUrl);
    } catch (err) {
      setUploadError(getErrorMessage(err));
    }
  }

  const body = (
    <>
      {embedded ? (
        <p className="text-xs text-partner-muted">Photos by stage · steps that need a photo ask for it in Service steps</p>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-partner-primary/15">
            <Camera className="h-4 w-4 text-partner-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-partner-text">Job evidence</p>
            <p className="text-[11px] text-partner-muted">Photos by stage · steps that need a photo ask for it in Work steps</p>
          </div>
        </div>
      )}

      {evidenceQuery.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-partner-muted" />
        </div>
      ) : evidenceQuery.isError ? (
        <p className="text-sm text-partner-danger">{getErrorMessage(evidenceQuery.error)}</p>
      ) : (
        <div className="space-y-3">
          {STAGES.map((stage) => {
            const items = byStage[stage] ?? [];
            return (
              <div key={stage} className="rounded-xl border border-partner-line bg-partner-bg/50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-partner-muted">
                  {stage}
                </p>
                {items.length === 0 ? (
                  <p className="mt-1 text-xs text-partner-muted">No evidence yet</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {items.map((item) => {
                      const url = evidencePreviewUrl(item);
                      return (
                        <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-partner-text-secondary">
                            {formatDate(item.capturedAt)} {formatTime(item.capturedAt)}
                            {item.isCurrent ? " · current" : ""}
                          </span>
                          {url && isApiMediaPath(url) ? (
                            // Held by the server and readable only with this session: fetched, not linked.
                            <button
                              type="button"
                              onClick={() =>
                                void openEvidenceMedia(url).then((ok) => {
                                  if (!ok) setUploadError("This photo could not be opened. Please try again.");
                                })
                              }
                              className="font-semibold text-partner-primary hover:underline"
                            >
                              View
                            </button>
                          ) : url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-partner-primary hover:underline"
                            >
                              View
                            </a>
                          ) : (
                            <span className="text-partner-muted">Captured</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2 border-t border-partner-line pt-3">
        <p className="text-xs font-semibold text-partner-text">Upload completion photo</p>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-partner-line px-3 py-2 text-xs font-semibold text-partner-primary">
          {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploadMutation.isPending}
            onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
          />
          {uploadMutation.isPending ? "Uploading…" : "Take or choose a photo"}
        </label>
        {uploadError ? <p className="text-xs text-partner-danger">{uploadError}</p> : null}
      </div>
    </>
  );
  return embedded ? (
    <div className="space-y-4" data-testid="job-evidence-panel">{body}</div>
  ) : (
    <PartnerCard hover={false} className="space-y-4" data-testid="job-evidence-panel">{body}</PartnerCard>
  );
}
