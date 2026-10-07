"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, ChevronDown, Clock, Loader2, UserX } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { useReportNoShowMutation } from "@/hooks/use-partner-data";
import { getErrorMessage } from "@/lib/api-error";
import { fileToDataUrl } from "@/lib/file-to-data-url";
import { formatInr } from "@/lib/format";
import { doorPhotoUploadId, noShowResultView, noShowView } from "@/lib/no-show";
import { partnerApi } from "@/services/partner-api";
import type { NoShowPreview, NoShowReportResult } from "@/types/partner";

/**
 * §52 — "Customer not available?" on the job page, after arrival and before start.
 *
 * Secondary on purpose: collapsed until the partner asks for it, so it never competes with Start.
 * Everything that matters is the server's — `preview` is the `noShow` block of
 * `GET /api/bookings/:id/actions`, and the sentence under the wait is the server's own. This
 * component writes labels only; whether a report can be sent, and what it will do, it reads.
 *
 * The door photo is ARRIVAL evidence sent through the same upload as every other job photo. The
 * page sends the image and nothing else: where the partner was is the server's to know.
 */
export function NoShowSection({
  bookingId,
  preview,
  fetchedAt,
  refreshing,
  onRefresh,
}: {
  bookingId: string;
  /** The server's answer; null once the report is no longer on offer (started, reported, closed). */
  preview: NoShowPreview | null;
  /** When that answer arrived (the query's `dataUpdatedAt`) — the countdown runs from here. */
  fetchedAt: number;
  refreshing: boolean;
  /** Ask the server again (the countdown reached zero). */
  onRefresh: () => void;
}) {
  const qc = useQueryClient();
  const report = useReportNoShowMutation();
  const panelId = useId();
  const waitId = useId();
  const titleId = useId();
  const bodyId = useId();

  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<NoShowReportResult | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  const reportButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const view = preview ? noShowView(preview, fetchedAt, now) : null;
  const waiting = open && preview != null && !preview.canReport;

  // The countdown: a clock tick while the section is open and the server has not opened the report.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [waiting]);

  // At zero the server is asked again; the button never opens on this device's clock.
  const shouldRefetch = waiting && view?.shouldRefetch === true && !refreshing;
  useEffect(() => {
    if (shouldRefetch) onRefresh();
  }, [shouldRefetch, onRefresh]);

  const upload = useMutation({
    mutationFn: async (file: File) =>
      partnerApi.uploadEvidence(bookingId, {
        stage: "ARRIVAL",
        mediaUrl: await fileToDataUrl(file),
        clientUploadId: doorPhotoUploadId(Date.now()),
      }),
    onMutate: () => {
      setUploadError(null);
      setUploaded(false);
    },
    onSuccess: () => setUploaded(true),
    onError: (err) => setUploadError(getErrorMessage(err)),
    onSettled: () => {
      // The server decides whether this photo counts; read its answer again either way.
      void qc.invalidateQueries({ queryKey: ["partner", "job-actions", bookingId] });
      void qc.invalidateQueries({ queryKey: ["partner", "job-evidence", bookingId] });
    },
  });

  const closeConfirm = () => {
    setConfirming(false);
    reportButtonRef.current?.focus();
  };

  // Focus goes into the dialog when it opens — to Cancel, the choice that changes nothing.
  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [confirming]);

  // After the report the button that opened the dialog is gone: focus lands on the result instead.
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !report.isPending) {
      e.stopPropagation();
      closeConfirm();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function submitReport() {
    if (report.isPending) return;
    setReportError(null);
    try {
      const data = await report.mutateAsync({ bookingId });
      setConfirming(false);
      setResult(data);
    } catch (err) {
      // GRACE_NOT_ELAPSED, NO_ARRIVAL_EVIDENCE, INVALID_STATUS…: the server's own sentence.
      setReportError(getErrorMessage(err));
      closeConfirm();
    }
  }

  if (result) {
    const shown = noShowResultView(result);
    return (
      <PartnerCard hover={false} className="space-y-2" data-testid="no-show-section">
        <div ref={resultRef} tabIndex={-1} role="status" data-testid="no-show-result" className="space-y-1 rounded-xl border border-partner-line bg-partner-bg/50 p-3 outline-none focus-visible:ring-2 focus-visible:ring-partner-primary">
          <p className="flex items-center gap-2 text-sm font-semibold text-partner-text">
            <UserX className="h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
            <span className="min-w-0 break-words">{shown.message || "Reported"}</span>
          </p>
          {shown.feeRecorded !== null ? (
            <p className="text-xs text-partner-text-secondary" data-testid="no-show-result-fee">Fee recorded: {formatInr(shown.feeRecorded)}</p>
          ) : null}
          {shown.feeNote ? (
            <p className="break-words text-xs text-partner-text-secondary" data-testid="no-show-result-note">{shown.feeNote}</p>
          ) : null}
        </div>
      </PartnerCard>
    );
  }

  if (!preview || !view) return null;

  return (
    <PartnerCard hover={false} className="space-y-3" data-testid="no-show-section" data-open={open}>
      <button
        type="button"
        data-testid="no-show-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setNow(Date.now());
          setOpen((v) => !v);
        }}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl text-left text-sm font-semibold text-partner-text-secondary transition hover:text-partner-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary"
      >
        <span className="flex min-w-0 items-center gap-2">
          <UserX className="h-4 w-4 shrink-0 text-partner-muted" aria-hidden="true" />
          <span className="min-w-0 break-words">Customer not available?</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-partner-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      <div id={panelId} hidden={!open} className="space-y-3">
        <p id={waitId} data-testid="no-show-wait" className="flex items-center gap-2 text-xs font-semibold text-partner-text">
          <Clock className="h-3.5 w-3.5 shrink-0 text-partner-muted" aria-hidden="true" />
          {view.waitLabel}
        </p>

        <p data-testid="no-show-message" className="break-words text-sm text-partner-text-secondary">
          {view.message}
        </p>

        {view.doorPhoto === "NOT_ASKED" ? null : (
          <div data-testid="no-show-door-photo" data-state={view.doorPhoto} className="space-y-2">
            {view.doorPhoto === "ADDED" ? (
              <p role="status" className="flex items-center gap-2 text-xs font-semibold text-partner-success">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                Door photo added
              </p>
            ) : (
              <>
                <label className="inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-xl border border-partner-line px-3 py-2 text-xs font-semibold text-partner-primary focus-within:ring-2 focus-within:ring-partner-primary">
                  {upload.isPending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    data-testid="no-show-door-photo-input"
                    disabled={upload.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      // Cleared so the same photo can be picked again after a refusal.
                      e.target.value = "";
                      if (file) upload.mutate(file);
                    }}
                  />
                  {upload.isPending ? "Uploading…" : "Add a photo at the door"}
                </label>
                {uploaded && !upload.isPending ? (
                  <p role="status" className="text-xs text-partner-text-secondary" data-testid="no-show-door-photo-uploaded">Photo uploaded.</p>
                ) : null}
              </>
            )}
            {uploadError ? (
              <p role="alert" className="break-words text-xs text-partner-danger" data-testid="no-show-door-photo-error">{uploadError}</p>
            ) : null}
          </div>
        )}

        <button
          ref={reportButtonRef}
          type="button"
          data-testid="no-show-report"
          disabled={!view.canReport || report.isPending}
          aria-describedby={waitId}
          onClick={() => {
            setReportError(null);
            setConfirming(true);
          }}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-400 px-3 py-2 text-sm font-semibold text-red-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-partner-danger"
        >
          Report customer not available
        </button>

        {reportError ? (
          <p role="alert" className="break-words text-xs text-partner-danger" data-testid="no-show-error">{reportError}</p>
        ) : null}
      </div>

      {confirming ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          onClick={() => {
            if (!report.isPending) closeConfirm();
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            data-testid="no-show-confirm"
            // Focusable itself, so a click on its text keeps focus inside it (and Escape / Tab keep working).
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onDialogKeyDown}
            className="relative w-full max-w-md space-y-4 rounded-2xl border border-partner-line bg-partner-card p-5 shadow-2xl outline-none"
          >
            <h2 id={titleId} className="break-words text-base font-semibold text-partner-text">
              Report customer not available?
            </h2>
            <p id={bodyId} data-testid="no-show-confirm-message" className="break-words text-sm text-partner-text-secondary">
              {view.message}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                data-testid="no-show-confirm-submit"
                disabled={report.isPending}
                onClick={() => void submitReport()}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-partner-primary px-4 py-2.5 text-sm font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {report.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {report.isPending ? "Reporting…" : "Report customer not available"}
              </button>
              <button
                ref={cancelRef}
                type="button"
                data-testid="no-show-confirm-cancel"
                disabled={report.isPending}
                onClick={closeConfirm}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-partner-line px-4 py-2.5 text-sm font-semibold text-partner-text transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PartnerCard>
  );
}
