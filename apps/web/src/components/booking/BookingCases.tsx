"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronRight, FileWarning, ImageOff, ImagePlus } from "lucide-react";
import { apiRequest, apiRequestRaw } from "@/services/auth/api-client";
import { useAppStore } from "@/stores/app-store";
import type { ApiResponse } from "@/types/auth";
import { CASE_PHOTO_ACCEPT, casePhotoError, casePhotoProblem, type CaseReportability } from "@/lib/case-report";

/**
 * Phase 10 §11 — the customer's reported issues on this booking, with a plain-words state timeline.
 * Server truth (customerView): the customer sees their case, their own evidence and state changes —
 * never admin reasons, notes or override text (the server does not send them, and nothing internal
 * is invented here). While a case is open the customer can add a note or a photo to it; the server
 * decides whether the case still accepts one. Stored photos are private: they are fetched with the
 * customer's own token and shown from an object URL, never linked directly.
 */

/** Mirrored by hand from bookingCaseService.customerView. */
type CaseView = {
  id: string;
  caseNumber: string;
  bookingId: string;
  type: string;
  category: string;
  state: string;
  description: string | null;
  createdAt: string;
  closedAt: string | null;
  eligibility: { warrantyCovers: boolean; proofRequired: boolean; proofMissing: boolean; reasonCodes: string[] };
  resolution: { action: string | null; status: string | null; refundPaise: number | null; followUpBookingId: string | null } | null;
  /** `hasStoredMedia`: the photo's bytes are behind the authenticated case media route. Absent on an older backend. */
  evidence: Array<{ id: number; kind: string; jobEvidenceId: string | null; mediaUrl: string | null; note: string | null; hasStoredMedia?: boolean; createdAt: string }>;
  timeline: Array<{ state: string; at: string }>;
};
type CasesView = { available: boolean; cases: CaseView[]; categories: string[]; report?: CaseReportability };

const CATEGORY_LABEL: Record<string, string> = {
  QUALITY: "Quality of the work",
  INCOMPLETE: "Work left unfinished",
  DAMAGE: "Something was damaged",
  BEHAVIOUR: "Professional's behaviour",
  NO_SHOW: "Professional did not show up",
  BILLING: "Billing or payment",
  OTHER: "Something else",
};

const STATE_LABEL: Record<string, string> = {
  CASE_CREATED: "Received",
  TRIAGE: "Being reviewed",
  ELIGIBILITY: "Checking what's covered",
  INVESTIGATION: "Being investigated",
  ACTION: "Being resolved",
  RESOLVED: "Resolved",
  REJECTED: "Closed — not approved",
  ESCALATED: "With our senior team",
};
/** booking-case-policy TERMINAL_CASE_STATES — the server refuses evidence on these (CASE_CLOSED). */
const CLOSED_STATES = new Set(["RESOLVED", "REJECTED"]);

const ACTION_LABEL: Record<string, string> = {
  REWORK: "A follow-up visit was arranged",
  REFUND: "A refund was issued",
  INSPECTION: "An inspection visit was arranged",
  REJECT: "No action was taken on this issue",
  NONE: "Closed with no further action",
};

/** The server's refusals for POST /:id/cases/:caseId/evidence, in the customer's words. */
const EVIDENCE_REFUSAL: Record<string, string> = {
  CASE_CLOSED: "This case is closed, so it can't take more details.",
  CASE_NOT_FOUND: "We couldn't find this case. Please reopen the booking and try again.",
  EVIDENCE_LIMIT: "This case already has the maximum number of notes and photos.",
  EVIDENCE_INVALID: "That note couldn't be added. Please check it and try again.",
  CASES_UNAVAILABLE: "Issue reporting isn't available right now. Please try again in a little while.",
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function BookingCases({
  bookingId,
  onOpenBooking,
}: {
  bookingId: string;
  /** Opens another booking's detail (the follow-up visit). Without it the visit is stated, not linked. */
  onOpenBooking?: (bookingId: string) => void;
}) {
  const q = useQuery({
    queryKey: ["bookings", "cases", bookingId],
    queryFn: () => apiRequest<ApiResponse<CasesView>>(`/api/bookings/${bookingId}/cases`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
  const v = q.data;
  if (!v || !v.available || v.cases.length === 0) return null;
  return (
    <section aria-labelledby={`booking-cases-${bookingId}`} data-testid="booking-cases">
      <h3 id={`booking-cases-${bookingId}`} className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-content">
        <FileWarning size={18} aria-hidden="true" /> Reported issues
      </h3>
      <ul className="space-y-3">
        {v.cases.map((c) => {
          const action = c.resolution?.action ? ACTION_LABEL[String(c.resolution.action)] ?? null : null;
          const refund = typeof c.resolution?.refundPaise === "number" && c.resolution.refundPaise > 0 ? c.resolution.refundPaise : null;
          const followUpId = c.resolution?.followUpBookingId ?? null;
          const open = !c.closedAt && !CLOSED_STATES.has(c.state);
          const notes = c.evidence.filter((e) => e.kind === "NOTE" && e.note);
          const photos = c.evidence.filter((e) => e.kind !== "NOTE" && e.hasStoredMedia === true);
          // Evidence with no stored photo to show (a job photo reference, or media kept elsewhere).
          const otherAttachments = c.evidence.filter((e) => e.kind !== "NOTE" && e.hasStoredMedia !== true).length;
          return (
            <li key={c.id} className="rounded-2xl glass-card p-4 text-sm" data-testid={`booking-case-${c.caseNumber}`} data-state={c.state}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-content">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                <p className="text-xs text-muted">Case {c.caseNumber}</p>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                <span className="font-semibold">{STATE_LABEL[c.state] ?? c.state}</span> · reported {dateTime(c.createdAt)}
              </p>
              {c.description ? <p className="mt-2 break-words text-content">{c.description}</p> : null}
              {action ? (
                <p className="mt-2 text-content" data-testid="booking-case-resolution">
                  {action}
                  {refund ? ` — ₹${(refund / 100).toLocaleString("en-IN")}` : ""}.
                </p>
              ) : null}

              {followUpId ? (
                onOpenBooking ? (
                  <button
                    type="button"
                    onClick={() => onOpenBooking(followUpId)}
                    data-testid="booking-case-follow-up"
                    className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface/60 px-3 py-2 text-left transition hover:bg-primary/5"
                  >
                    <CalendarCheck size={18} className="shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-content">Follow-up visit booked</span>
                      <span className="block text-xs text-muted">View the follow-up booking</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
                  </button>
                ) : (
                  <p className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-surface/60 px-3 py-2" data-testid="booking-case-follow-up">
                    <CalendarCheck size={18} className="shrink-0 text-primary" aria-hidden="true" />
                    <span>
                      <span className="block font-semibold text-content">Follow-up visit booked</span>
                      <span className="block text-xs text-muted">You&apos;ll find it in My Bookings.</span>
                    </span>
                  </p>
                )
              ) : null}

              {notes.length > 0 || photos.length > 0 || otherAttachments > 0 ? (
                <div className="mt-3 border-t border-line pt-2" data-testid="booking-case-evidence">
                  <p className="text-xs font-semibold text-muted">What you sent us</p>
                  {notes.length > 0 || otherAttachments > 0 ? (
                    <ul className="mt-1 space-y-1">
                      {notes.map((e) => (
                        <li key={e.id} className="break-words text-content">
                          {e.note} <span className="text-xs text-muted">· {dateTime(e.createdAt)}</span>
                        </li>
                      ))}
                      {otherAttachments > 0 ? (
                        <li className="text-xs text-muted">{otherAttachments === 1 ? "1 other attachment" : `${otherAttachments} other attachments`}</li>
                      ) : null}
                    </ul>
                  ) : null}
                  {photos.length > 0 ? (
                    <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={`Photos on case ${c.caseNumber}`} data-testid="booking-case-photos">
                      {photos.map((e, i) => (
                        <li key={e.id}>
                          <CasePhoto
                            bookingId={bookingId}
                            caseId={c.id}
                            evidenceId={e.id}
                            label={`Photo ${i + 1} of ${photos.length} you added to case ${c.caseNumber}, ${dateTime(e.createdAt)}`}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {open ? (
                <div className="mt-3 flex flex-wrap items-start gap-2">
                  <AddCaseNote bookingId={bookingId} caseId={c.id} caseNumber={c.caseNumber} />
                  <AddCasePhoto bookingId={bookingId} caseId={c.id} caseNumber={c.caseNumber} />
                </div>
              ) : null}

              {c.timeline.length > 0 ? (
                <ol className="mt-3 space-y-1 border-t border-line pt-2 text-xs text-muted" aria-label={`Case ${c.caseNumber} progress`}>
                  {c.timeline.map((t, i) => (
                    <li key={`${t.state}-${t.at}-${i}`}>
                      {STATE_LABEL[t.state] ?? t.state} · {dateTime(t.at)}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A photo upload outlasts the API client's default window on a slow connection. */
const PHOTO_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * One photo on an open case — POST /:id/cases/:caseId/evidence/photo (multipart, field `file`).
 * Type and size are checked here only to save a pointless upload; the server reads the bytes and
 * decides. One photo at a time, because the server takes one per request.
 */
function AddCasePhoto({ bookingId, caseId, caseNumber }: { bookingId: string; caseId: string; caseNumber: string }) {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `case-photo-${caseId}`;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file, file.name);
      let res: Response;
      try {
        res = await apiRequestRaw(`/api/bookings/${bookingId}/cases/${encodeURIComponent(caseId)}/evidence/photo`, {
          method: "POST",
          body,
          timeoutMs: PHOTO_UPLOAD_TIMEOUT_MS,
        });
      } catch {
        throw new Error("The photo couldn't be sent. Check your connection and try again.");
      }
      const json = (await res.json().catch(() => null)) as { success?: boolean; code?: string } | null;
      if (!res.ok || !json?.success) throw new Error(casePhotoError(json?.code));
    },
    onSuccess: () => {
      setError(null);
      showToast("Photo added to your case", "success");
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : casePhotoError(null);
      setError(message);
      showToast(message, "error");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["bookings", "cases", bookingId] }),
  });

  function onPick(files: FileList | null) {
    const file = files?.[0];
    // Reset so choosing the same file again after an error still fires a change.
    if (inputRef.current) inputRef.current.value = "";
    if (!file || upload.isPending) return;
    const problem = casePhotoProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    upload.mutate(file);
  }

  return (
    <div className="min-w-0">
      <label
        htmlFor={fieldId}
        aria-busy={upload.isPending}
        className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-content transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40 ${
          upload.isPending ? "cursor-progress opacity-60" : "cursor-pointer hover:bg-primary/5"
        }`}
        data-testid="booking-case-add-photo"
      >
        <ImagePlus size={16} aria-hidden="true" />
        {upload.isPending ? "Uploading photo…" : "Add a photo"}
        <input
          ref={inputRef}
          id={fieldId}
          type="file"
          accept={CASE_PHOTO_ACCEPT}
          disabled={upload.isPending}
          onChange={(e) => onPick(e.target.files)}
          aria-label={`Add a photo to case ${caseNumber}`}
          aria-describedby={`${fieldId}-hint${error ? ` ${fieldId}-error` : ""}`}
          className="sr-only"
        />
      </label>
      <p id={`${fieldId}-hint`} className="mt-1 text-xs text-muted">
        JPG, PNG or WEBP, up to 8 MB.
      </p>
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="mt-1 text-sm text-error" data-testid="booking-case-photo-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One stored photo, from GET /:id/cases/:caseId/evidence/:evidenceId/media. The route needs the
 * customer's token, so it cannot be an <img src>: the bytes are fetched with the authenticated
 * client and shown from an object URL that is revoked when the photo leaves the page.
 */
function CasePhoto({ bookingId, caseId, evidenceId, label }: { bookingId: string; caseId: string; evidenceId: number; label: string }) {
  const q = useQuery({
    queryKey: ["bookings", "case-media", bookingId, caseId, evidenceId],
    queryFn: async () => {
      const res = await apiRequestRaw(`/api/bookings/${bookingId}/cases/${encodeURIComponent(caseId)}/evidence/${evidenceId}/media`);
      if (!res.ok) throw new Error("media unavailable");
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("media unavailable");
      return blob;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const blob = q.data;
  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setSrc(url);
    setBroken(false);
    return () => {
      URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [blob]);

  const frame = "flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-surface/60";

  if (q.isError || broken) {
    return (
      <div className={`${frame} flex-col gap-1 p-1 text-center text-[11px] text-muted`} role="img" aria-label={`${label} — photo unavailable`} data-testid="booking-case-photo-unavailable">
        <ImageOff size={16} aria-hidden="true" />
        <span aria-hidden="true">Photo unavailable</span>
      </div>
    );
  }
  if (!src) {
    return (
      <div className={`${frame} animate-pulse`} role="status" data-testid="booking-case-photo-loading">
        <span className="sr-only">Loading photo…</span>
      </div>
    );
  }
  return (
    <div className={frame}>
      {/* A blob: object URL — next/image cannot optimise it, and the bytes are already local. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="size-full object-cover" onError={() => setBroken(true)} data-testid="booking-case-photo" />
    </div>
  );
}

/** Optional extra detail on an open case — a NOTE through the evidence endpoint. */
function AddCaseNote({ bookingId, caseId, caseNumber }: { bookingId: string; caseId: string; caseNumber: string }) {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fieldId = `case-note-${caseId}`;

  const add = useMutation({
    mutationFn: () =>
      apiRequest<ApiResponse<unknown>>(`/api/bookings/${bookingId}/cases/${encodeURIComponent(caseId)}/evidence`, {
        method: "POST",
        auth: true,
        body: { evidence: [{ kind: "NOTE", note: note.trim() }] },
      }),
    onSuccess: () => {
      showToast("Added to your case", "success");
      setNote("");
      setError(null);
      setExpanded(false);
    },
    onError: (e) => {
      const code = (e as { code?: string } | null)?.code;
      setError((code && EVIDENCE_REFUSAL[code]) || (e instanceof Error && e.message ? e.message : "Could not add this note. Please try again."));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["bookings", "cases", bookingId] }),
  });

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        data-testid="booking-case-add-note"
        className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-content transition hover:bg-primary/5"
      >
        Add more details
      </button>
    );
  }

  return (
    <form
      className="w-full space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!note.trim() || add.isPending) return;
        setError(null);
        add.mutate();
      }}
    >
      <label htmlFor={fieldId} className="block text-sm font-semibold text-content">
        Add more details to case {caseNumber}
      </label>
      <textarea
        id={fieldId}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        rows={3}
        data-testid="booking-case-note"
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className="w-full rounded-xl border border-line bg-transparent p-3 text-sm text-content outline-none focus:border-primary"
        placeholder="Anything else our team should know?"
      />
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!note.trim() || add.isPending}
          data-testid="booking-case-note-submit"
          className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {add.isPending ? "Sending..." : "Send"}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setError(null);
          }}
          className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-content"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
