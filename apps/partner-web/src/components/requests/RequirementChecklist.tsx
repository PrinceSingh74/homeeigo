"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, ShieldCheck, XCircle } from "lucide-react";
import { useBookingRequirementsQuery, useRequirementCheckMutation } from "@/hooks/use-partner-data";
import { getPartnerCoords } from "@/lib/partner-coords";
import type { RequirementItemView } from "@/types/partner";

/**
 * Phase 10 §6 — the partner's task-first requirement checklist.
 *
 * Everything here is the server's view of the booking's OWN requirement state
 * (`GET /api/bookings/:id/requirements`): what must be in place, who owns it, whether it is
 * recorded, and what is blocking START. The buttons record what the partner FOUND on site — the
 * server decides whether the gate passes, and the same GPS proximity rule as arrival applies.
 * A blocked item is perceivable without colour: icon + explicit state word + sentence.
 */

const STATE_LABEL: Record<RequirementItemView["state"], string> = {
  UNRESOLVED: "Not checked yet",
  SATISFIED: "In place",
  FAILED: "Missing",
  EXPIRED: "Check again — the appointment moved",
};

const POINT_LABEL: Record<RequirementItemView["enforcementPoint"], string> = {
  BEFORE_BOOKING: "Confirmed at booking",
  BEFORE_ARRIVAL: "Required before arrival",
  AT_START: "Required before start",
};

function StateIcon({ state }: { state: RequirementItemView["state"] }) {
  const cls = "h-4 w-4 shrink-0";
  if (state === "SATISFIED") return <CheckCircle2 className={`${cls} text-partner-success`} aria-hidden="true" />;
  if (state === "FAILED") return <XCircle className={`${cls} text-red-500`} aria-hidden="true" />;
  if (state === "EXPIRED") return <Clock className={`${cls} text-amber-500`} aria-hidden="true" />;
  return <CircleDashed className={`${cls} text-partner-muted`} aria-hidden="true" />;
}

function groupOf(item: RequirementItemView): "BLOCKED" | "REQUIRED_NOW" | "BEFORE_ARRIVAL" | "OPTIONAL" | "COMPLETED" {
  if (item.state === "SATISFIED") return "COMPLETED";
  if (item.optional) return "OPTIONAL";
  if (item.state === "FAILED" || item.state === "EXPIRED") return "BLOCKED";
  return item.enforcementPoint === "AT_START" ? "REQUIRED_NOW" : "BEFORE_ARRIVAL";
}

const GROUP_TITLE = {
  BLOCKED: "Blocked",
  REQUIRED_NOW: "Required before start",
  BEFORE_ARRIVAL: "Required before arrival",
  OPTIONAL: "Optional",
  COMPLETED: "Completed",
} as const;
const GROUP_ORDER = ["BLOCKED", "REQUIRED_NOW", "BEFORE_ARRIVAL", "OPTIONAL", "COMPLETED"] as const;

export function RequirementChecklist({
  bookingId,
  active,
  gate,
  heading = true,
}: {
  bookingId: string;
  /** The page's section heading already names this block (the title stays for screen readers). */
  heading?: boolean;
  /** Only an active job can be worked on; a finished one is read-only. */
  active: boolean;
  /** The server's START gate from `/actions`, when already loaded — shown as the banner. */
  gate: { ok: boolean; blocking: number; message: string } | null | undefined;
}) {
  const query = useBookingRequirementsQuery(bookingId);
  const check = useRequirementCheckMutation(bookingId);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [locating, setLocating] = useState<string | null>(null);

  const view = query.data;
  if (query.isLoading) return <p className="text-xs text-partner-muted">Loading requirements…</p>;
  if (!view || !view.enforced || view.items.length === 0) return null;

  const startGate = gate ?? { ok: view.gate.start.ok, blocking: view.gate.start.blocking.length, message: "" };

  async function record(code: string, outcome: "SATISFIED" | "FAILED") {
    setLocating(code);
    try {
      const coords = await getPartnerCoords("strict");
      // With no position from this device the server decides: it accepts the check only if the
      // customer (or support) has confirmed the partner is there, and otherwise says what to do.
      await check.mutateAsync({ code, outcome, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null, note: outcome === "FAILED" && note.trim() ? note.trim() : undefined });
      setNoteFor(null);
      setNote("");
    } catch {
      /* toast already shown by the mutation */
    } finally {
      setLocating(null);
    }
  }

  const groups = GROUP_ORDER.map((g) => ({ key: g, items: view.items.filter((i) => groupOf(i) === g) })).filter((g) => g.items.length);

  return (
    <section className="space-y-3" data-testid="requirement-checklist" aria-labelledby={`req-${bookingId}`}>
      <p id={`req-${bookingId}`} className={heading ? "flex items-center gap-1.5 text-sm font-semibold text-partner-text" : "sr-only"}>
        <ShieldCheck className="h-4 w-4 text-partner-primary" aria-hidden="true" />
        Requirements
      </p>
      {active && !startGate.ok ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-900" data-testid="requirement-gate-blocked">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Start is blocked</p>
            <p>{startGate.message || `${startGate.blocking} requirement${startGate.blocking === 1 ? "" : "s"} still need${startGate.blocking === 1 ? "s" : ""} to be checked on site.`}</p>
          </div>
        </div>
      ) : active && startGate.ok ? (
        <p role="status" className="text-xs text-partner-success" data-testid="requirement-gate-ok">All requirements are in place.</p>
      ) : null}

      {groups.map((g) => (
        <div key={g.key}>
          <p className="text-xs font-semibold uppercase tracking-wide text-partner-muted">{GROUP_TITLE[g.key]}</p>
          <ul className="mt-1 divide-y divide-partner-border/60">
            {g.items.map((item) => {
              const canCheck = active && item.actions.includes("CHECK");
              const busy = locating === item.code || (check.isPending && check.variables?.code === item.code);
              return (
                <li key={item.code} className="py-2 first:pt-0 last:pb-0" data-testid={`requirement-${item.code}`} data-state={item.state}>
                  <div className="flex items-start gap-2">
                    <StateIcon state={item.state} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-partner-text">
                        {item.label}
                        {item.optional ? <span className="ml-2 text-[11px] font-normal text-partner-muted">optional</span> : null}
                      </p>
                      <p className="text-xs text-partner-muted">
                        <span className="font-semibold">{STATE_LABEL[item.state]}</span> · {POINT_LABEL[item.enforcementPoint]} ·{" "}
                        {item.responsibility === "CUSTOMER" ? "customer provides" : item.responsibility === "PROFESSIONAL" ? "you provide" : "shared"}
                      </p>
                      {item.blocking ? <p className="mt-0.5 text-xs text-amber-900 dark:text-amber-400">{item.blocking.remediation.text}</p> : null}
                      {item.note ? <p className="mt-0.5 text-xs text-partner-text-secondary">Your note: {item.note}</p> : null}
                    </div>
                  </div>
                  {canCheck ? (
                    <div className="mt-2 flex flex-wrap gap-2 pl-6">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void record(item.code, "SATISFIED")}
                        aria-label={`Record ${item.label} as in place`}
                        className="min-h-11 rounded-xl bg-partner-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {item.state === "SATISFIED" ? "Re-check: in place" : "In place"}
                      </button>
                      {noteFor === item.code ? (
                        <div className="flex w-full flex-col gap-2">
                          <label className="text-xs text-partner-muted" htmlFor={`note-${item.code}`}>What is missing? (optional, the customer does not see this)</label>
                          <input
                            id={`note-${item.code}`}
                            value={note}
                            maxLength={500}
                            onChange={(e) => setNote(e.target.value)}
                            className="min-h-11 rounded-xl border border-partner-line px-3 text-sm"
                          />
                          <div className="flex gap-2">
                            <button type="button" disabled={busy} onClick={() => void record(item.code, "FAILED")} aria-label={`Record ${item.label} as missing`} className="min-h-11 rounded-xl border border-red-400 px-3 py-2 text-xs font-semibold text-red-700 dark:text-partner-danger disabled:opacity-50">
                              Confirm missing
                            </button>
                            <button type="button" onClick={() => { setNoteFor(null); setNote(""); }} className="min-h-11 rounded-xl border border-partner-line px-3 py-2 text-xs font-semibold text-partner-text">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setNoteFor(item.code)}
                          aria-label={`Report ${item.label} as missing`}
                          className="min-h-11 rounded-xl border border-partner-line px-3 py-2 text-xs font-semibold text-partner-text disabled:opacity-50"
                        >
                          Not in place
                        </button>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {query.isFetching ? <p className="text-[11px] text-partner-muted">Refreshing…</p> : null}
    </section>
  );
}
