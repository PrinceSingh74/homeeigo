"use client";

/**
 * Data-subject requests and consent withdrawal, for the account holder.
 *
 * Both capabilities existed in the backend with no customer consumer. The practical consequence was
 * that a customer could submit a ZIP export, receive a toast with a truncated reference, and then
 * have no way to see its status or download the result — `myRequests` and `exportDownload` were
 * defined in the API client and never called. Consent withdrawal had no client method at all.
 *
 * Under DPDP/GDPR a data subject must be able to withdraw consent and follow a request through, so
 * this is a legal requirement rather than a product preference. It is deliberately placed inside the
 * existing "Privacy & data" settings section rather than a new screen.
 *
 * The backend is the only source of truth for status. Nothing here optimistically marks a request
 * complete, and the download link is whatever the server returned — never constructed locally.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileText, ShieldOff } from "lucide-react";
import { coreApi, type ConsentPolicyType } from "@/services/core/api";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

type RequestRow = {
  id: string;
  requestType: string;
  status: string;
  submittedAt: string;
  dueDateAt: string;
  slaDaysRemaining?: number;
};

/** The four the backend accepts. Anything else is rejected with 400 INVALID_INPUT. */
const POLICIES: Array<{ value: ConsentPolicyType; label: string; note: string }> = [
  { value: "PRIVACY", label: "Privacy Policy", note: "How your data is collected and used" },
  { value: "COOKIES", label: "Cookie Policy", note: "Non-essential cookies and analytics" },
  { value: "TERMS", label: "Terms of Service", note: "Withdrawing may prevent new bookings" },
  { value: "REFUND", label: "Refund Policy", note: "Applies to future bookings" },
];

/** Terminal states, so a settled request stops inviting a refresh. */
const SETTLED = new Set(["COMPLETED", "REJECTED", "CANCELLED", "FAILED"]);

function statusTone(status: string): string {
  const s = status.toUpperCase();
  if (s === "COMPLETED") return "text-success";
  if (s === "REJECTED" || s === "FAILED") return "text-error";
  return "text-muted";
}

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function DataRequests() {
  const showToast = useAppStore((s) => s.showToast);

  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<ConsentPolicyType | null>(null);
  /** Guards a second submission while the first is in flight, per policy. */
  const [withdrawn, setWithdrawn] = useState<Set<ConsentPolicyType>>(new Set());

  const load = useCallback(async () => {
    try {
      const rows = await coreApi.compliance.myRequests(20);
      setRequests(rows);
      setLoadError(false);
    } catch {
      // Distinguished from "no requests" below: an empty list and a failed read must not look alike.
      setLoadError(true);
      setRequests(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCount = useMemo(
    () => (requests ?? []).filter((r) => !SETTLED.has(r.status.toUpperCase())).length,
    [requests],
  );

  /**
   * Resolves the authoritative status, and the export download link when the server has one.
   *
   * The link is taken from the response. Building a download URL client-side would produce a button
   * that looks ready before the export exists.
   */
  const checkRequest = async (requestId: string) => {
    setBusyId(requestId);
    try {
      const detail = await coreApi.compliance.getRequest(requestId);
      const url = detail.export?.fileUrl ?? null;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        showToast(
          `Request is ${detail.status.toLowerCase().replace(/_/g, " ")}. ` +
            (detail.rejectionReason ? `Reason: ${detail.rejectionReason}` : `Due ${formatDate(detail.dueDateAt)}.`),
          "info",
        );
      }
      await load();
    } catch {
      showToast("Could not read that request right now", "error");
    } finally {
      setBusyId(null);
    }
  };

  const withdraw = async (policy: ConsentPolicyType) => {
    if (withdrawing || withdrawn.has(policy)) return;
    setWithdrawing(policy);
    try {
      await coreApi.compliance.withdrawConsent(policy);
      setWithdrawn((prev) => new Set(prev).add(policy));
      showToast(`Consent withdrawn for ${policy.toLowerCase()}. This is recorded against your account.`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not withdraw consent", "error");
    } finally {
      setWithdrawing(null);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      {/* ── Your data requests ─────────────────────────────────────────────── */}
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-content">
          <FileText size={15} className="text-primary" />
          Your data requests
          {openCount > 0 ? <span className="text-xs font-semibold text-muted">({openCount} open)</span> : null}
        </h3>

        {loadError ? (
          <div className="mt-3 rounded-xl border border-line px-4 py-3">
            <p className="text-sm text-muted">We could not load your requests.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-sm font-semibold text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : requests === null ? (
          <p className="mt-3 text-sm text-muted">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            You have not made any data requests. Exporting or deleting your data creates one here.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {requests.map((r) => {
              const settled = SETTLED.has(r.status.toUpperCase());
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-content">
                      {r.requestType.replace(/_/g, " ").toLowerCase()}
                      <span className={cn("ml-2 text-xs font-semibold uppercase", statusTone(r.status))}>
                        {r.status.replace(/_/g, " ")}
                      </span>
                    </p>
                    <p className="text-xs text-muted">
                      Submitted {formatDate(r.submittedAt)}
                      {!settled ? ` · due ${formatDate(r.dueDateAt)}` : null}
                      {!settled && typeof r.slaDaysRemaining === "number"
                        ? ` · ${r.slaDaysRemaining} day${r.slaDaysRemaining === 1 ? "" : "s"} left`
                        : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void checkRequest(r.id)}
                    aria-label={`Check status of ${r.requestType.toLowerCase()} request`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold text-content transition hover:border-primary hover:text-primary disabled:opacity-60"
                  >
                    <Download size={14} />
                    {busyId === r.id ? "Checking…" : "Check / download"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Withdraw consent ───────────────────────────────────────────────── */}
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-content">
          <ShieldOff size={15} className="text-primary" />
          Withdraw consent
        </h3>
        <p className="mt-1 text-xs text-muted">
          Withdrawing is recorded against your account and applies from now on. It does not delete data already
          collected — use Delete account for that.
        </p>
        <ul className="mt-3 space-y-2">
          {POLICIES.map((p) => {
            const done = withdrawn.has(p.value);
            return (
              <li
                key={p.value}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-content">{p.label}</p>
                  <p className="text-xs text-muted">{p.note}</p>
                </div>
                <button
                  type="button"
                  disabled={done || withdrawing !== null}
                  onClick={() => void withdraw(p.value)}
                  aria-label={`Withdraw consent for ${p.label}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold text-content transition hover:border-error hover:text-error disabled:opacity-60"
                >
                  {done ? "Withdrawn" : withdrawing === p.value ? "Withdrawing…" : "Withdraw"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
