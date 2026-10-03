"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { completionGate } from "@/lib/completion-checklist";
import type { ApiResponse } from "@/types/partner";

/**
 * The service quality checklist the partner ticks off before "Mark complete".
 *
 * The items are the booking's FROZEN checklist (`GET /api/bookings/:id` →
 * `booking.execution.quality.checklist`), rendered as the exact strings the server will match the
 * submission against. Ticks live in the page (the Complete action reads them); this component only
 * shows and edits them. After a refused complete, the items the server listed as missing
 * (`GET /api/bookings/:id/quality` → last history entry's `missingChecklistItems`) are marked
 * "still needed" so the partner sees what the server, not the client, is waiting for.
 *
 * Accessibility: real checkboxes with labels inside a fieldset/legend, keyboard operable, visible
 * focus ring; state is perceivable without colour (checkbox state + explicit words).
 */

/** Mirrored by hand from bookingQualityService.viewFor (partner audience) — only what is read here. */
type QualityHistoryView = {
  history?: Array<{ verdict: string; missingChecklistItems: string[] }>;
};

export function CompletionChecklist({
  bookingId,
  checklist,
  ticked,
  onToggle,
  loading = false,
}: {
  bookingId: string;
  /** The frozen checklist, exact strings, in server order. */
  checklist: string[];
  /** Items the partner has ticked (exact strings). */
  ticked: ReadonlySet<string>;
  onToggle: (item: string, checked: boolean) => void;
  /** The policy is still loading — render the frame, not a false "no checklist". */
  loading?: boolean;
}) {
  // Same key and endpoint as QualityPanel, so react-query serves one fetch to both.
  const quality = useQuery({
    queryKey: ["partner", "quality", bookingId],
    queryFn: () => apiRequest<ApiResponse<QualityHistoryView>>(`/api/bookings/${bookingId}/quality`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 10_000,
  });

  if (loading) return <p className="text-xs text-partner-muted">Loading service checklist…</p>;
  if (checklist.length === 0) return null;

  const gate = completionGate(checklist, ticked);
  const history = quality.data?.history ?? [];
  const last = history.length ? history[history.length - 1] : null;
  const stillNeeded = new Set((last?.missingChecklistItems ?? []).filter((item) => !ticked.has(item)));
  const done = checklist.length - gate.missing.length;
  const legendId = `completion-checklist-${bookingId}`;

  return (
    <fieldset className="min-w-0 space-y-3 border-0 p-0" data-testid="completion-checklist" aria-describedby={`${legendId}-hint`}>
      <legend id={legendId} className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
        <ClipboardCheck className="h-4 w-4 text-partner-primary" aria-hidden="true" />
        Service checklist <span className="font-normal text-partner-muted">· {done} of {checklist.length} ticked</span>
      </legend>
      {gate.allowed ? (
        <p id={`${legendId}-hint`} role="status" className="text-xs text-partner-success" data-testid="completion-checklist-ok">
          Every item is ticked — you can mark this job complete.
        </p>
      ) : (
        <p id={`${legendId}-hint`} role="status" className="flex items-start gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-900" data-testid="completion-checklist-blocked">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {gate.hint}
        </p>
      )}
      <ul className="divide-y divide-partner-border/60">
        {checklist.map((item, index) => {
          const id = `${legendId}-${index}`;
          const checked = ticked.has(item);
          const needed = stillNeeded.has(item);
          return (
            <li key={`${index}:${item}`} className="py-2 first:pt-0 last:pb-0" data-testid="completion-checklist-item" data-checked={checked} data-still-needed={needed || undefined}>
              <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3">
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggle(item, e.target.checked)}
                  aria-describedby={needed ? `${id}-needed` : undefined}
                  className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-partner-line accent-partner-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary focus-visible:ring-offset-2"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-partner-text">{item}</span>
                  {needed ? (
                    <span id={`${id}-needed`} className="block text-xs font-semibold text-amber-900 dark:text-amber-400">
                      Still needed — the last completion attempt was refused without this item.
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
