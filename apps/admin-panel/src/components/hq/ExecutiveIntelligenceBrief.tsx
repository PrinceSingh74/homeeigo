"use client";

import { memo, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, Info } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { DataUnavailable, HqLoading, SectionHeading } from "./primitives";
import { isDegradedState, renderItemValue } from "@/lib/intelligence-render";
import type { ExecutiveBriefItem, ExecutiveBriefPeriod, ReportItemKind } from "@/types/admin";

/**
 * Phase 9, Capability 12 — the Executive Brief on the existing Executive Dashboard.
 *
 * ── What this is not ───────────────────────────────────────────────────────────
 *
 * Not a second KPI grid. `ExecutiveKpiGrid` already renders headline numbers from the finance
 * dashboard and geo-intelligence, and duplicating them here would give an executive two cards for
 * one figure with no way to tell which is authoritative. This panel adds what those cards cannot
 * show: **where each number came from, how fresh it is, and what is wrong with it.**
 *
 * ── One request ────────────────────────────────────────────────────────────────
 *
 * A single `executiveBrief()` call. The backend builds the executive context once and hands it to
 * every capability; nine per-section calls would rebuild it nine times per page load.
 *
 * ── Nothing is calculated here ─────────────────────────────────────────────────
 *
 * No GMV, revenue, refund, payout, wallet or margin arithmetic. Values are rendered exactly as the
 * ledger-backed services produced them, and a formatted string is never parsed back into a number.
 * The only thing this file decides is *grouping* — which of six kinds a line belongs to — and that
 * comes from the item's own `kind`.
 *
 * ── Known defects stay visible ─────────────────────────────────────────────────
 *
 * `netRevenue`'s mixed-period issue, the stale forecast, the unusable supply telemetry and the
 * refused anomaly baseline all render as their own states and limitations. There is no "healthy"
 * summary that could swallow them.
 */

/** Kinds in the order an executive should meet them: what is true, then what is wrong, then advice. */
const KIND_ORDER: ReportItemKind[] = [
  "FACT", "ANOMALY", "WARNING", "FORECAST", "RECOMMENDATION", "LIMITATION",
];

const KIND_LABEL: Record<ReportItemKind, string> = {
  FACT: "Measured facts",
  ANOMALY: "Anomaly checks",
  WARNING: "Warnings",
  FORECAST: "Forecasts",
  RECOMMENDATION: "Recommended reviews",
  LIMITATION: "Limitations",
};

/**
 * A short, honest gloss for each kind.
 *
 * The forecast one is load-bearing: an executive who reads a projection as a measurement will act on
 * a number the platform never observed.
 */
const KIND_HINT: Record<ReportItemKind, string> = {
  FACT: "Observed values, carried unchanged from the ledger-backed source.",
  ANOMALY: "Detector output. A refusal is reported as a refusal, not as “no anomaly”.",
  WARNING: "Conditions worth attention. Not incidents, and not conclusions.",
  FORECAST: "Projections, not measurements. Never an actual, never a simulation.",
  RECOMMENDATION: "Advisory only. Nothing here executes; high-risk actions go to Approvals.",
  LIMITATION: "Known problems with the data above. Part of the report, not a footnote.",
};

const ItemRow = memo(function ItemRow({ item }: { item: ExecutiveBriefItem }) {
  const { text, missing } = renderItemValue(item.value, item.unit);
  const degraded = isDegradedState(item.state);
  return (
    <tr className="border-t border-[var(--color-biz-line)] align-top">
      <th scope="row" className="py-2 pr-3 text-left text-xs font-medium text-[var(--color-biz-text)]">
        {item.label}
      </th>
      <td className="py-2 pr-3 text-xs tabular-nums text-[var(--color-biz-text)]">
        {missing ? (
          <span className="text-[var(--color-biz-muted)]">— <span className="sr-only">not reported</span></span>
        ) : (
          text
        )}
      </td>
      <td className="py-2 pr-3">
        {/*
          The state is spelled out, not encoded as a colour. A red dot alone fails for anyone who
          cannot distinguish it, and "STALE" is information a screen reader must receive too.
        */}
        <span
          className={
            degraded
              ? "rounded-md bg-[var(--color-biz-danger)]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-danger)]"
              : "rounded-md bg-[var(--color-biz-surface)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]"
          }
        >
          {item.state}
        </span>
      </td>
      <td className="py-2 pr-3 text-[11px] text-[var(--color-biz-muted)]">{item.source}</td>
      <td className="py-2 text-[11px] text-[var(--color-biz-muted)]">
        {item.freshness ?? (item.observedAt ? new Date(item.observedAt).toLocaleString() : "—")}
      </td>
    </tr>
  );
});

const KindSection = memo(function KindSection({
  kind, items,
}: {
  kind: ReportItemKind;
  items: ExecutiveBriefItem[];
}) {
  // Empty is a valid answer. No fraud cases and no recommendations are good news, and the panel
  // says so rather than fabricating a row to fill the space.
  if (items.length === 0) {
    return (
      <section aria-labelledby={`brief-${kind}`} className="min-w-0">
        <h3 id={`brief-${kind}`} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
          {KIND_LABEL[kind]}
        </h3>
        <p className="mt-1 text-xs text-[var(--color-biz-muted)]">Nothing reported for this period.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby={`brief-${kind}`} className="min-w-0">
      <h3 id={`brief-${kind}`} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
        {KIND_LABEL[kind]} <span className="text-[var(--color-biz-faint)]">({items.length})</span>
      </h3>
      <p className="mt-0.5 text-[11px] text-[var(--color-biz-faint)]">{KIND_HINT[kind]}</p>
      {/* Wide content scrolls inside its own container so the page never scrolls sideways. */}
      <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={`${KIND_LABEL[kind]} table`}>
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <caption className="sr-only">{KIND_LABEL[kind]} — value, state, source and freshness</caption>
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-biz-faint)]">
              <th scope="col" className="pb-1 pr-3 font-semibold">Item</th>
              <th scope="col" className="pb-1 pr-3 font-semibold">Value</th>
              <th scope="col" className="pb-1 pr-3 font-semibold">State</th>
              <th scope="col" className="pb-1 pr-3 font-semibold">Source</th>
              <th scope="col" className="pb-1 font-semibold">Freshness</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <ItemRow key={`${item.kind}:${item.label}:${i}`} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});

const PERIODS: ExecutiveBriefPeriod[] = ["daily", "weekly", "monthly"];

export const ExecutiveIntelligenceBrief = memo(function ExecutiveIntelligenceBrief() {
  const [period, setPeriod] = useState<ExecutiveBriefPeriod>("daily");

  const brief = useQuery({
    queryKey: ["hq", "exec", "phase9-brief", period],
    queryFn: () => adminApi.executiveBrief(period),
    // The brief re-reads every source at assembly time; caching it for long would reintroduce
    // exactly the "yesterday's numbers shown as today's" failure the backend guards against.
    staleTime: 60_000,
    retry: 1,
  });

  const grouped = useMemo(() => {
    const out = new Map<ReportItemKind, ExecutiveBriefItem[]>();
    for (const k of KIND_ORDER) out.set(k, []);
    for (const item of brief.data?.items ?? []) out.get(item.kind)?.push(item);
    return out;
  }, [brief.data]);

  return (
    <div className="biz-glass-panel min-w-0 p-5">
      <SectionHeading
        title="Executive brief — provenance"
        hint={brief.data ? `rules ${brief.data.versions.reportRulesVersion}` : undefined}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Report period" className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={
                period === p
                  ? "rounded-lg bg-[var(--color-biz-accent)]/15 px-2.5 py-1 text-xs font-semibold capitalize text-[var(--color-biz-accent)]"
                  : "rounded-lg px-2.5 py-1 text-xs font-medium capitalize text-[var(--color-biz-muted)] hover:text-[var(--color-biz-text)]"
              }
            >
              {p}
            </button>
          ))}
        </div>
        {brief.data ? (
          <span className="ml-auto text-[11px] text-[var(--color-biz-faint)]">
            assembled in {brief.data.timings.totalMs} ms
          </span>
        ) : null}
      </div>

      {/* LOADING */}
      {brief.isLoading ? <HqLoading label="Assembling executive brief…" /> : null}

      {/* ERROR — never a blank panel, and never a zero. */}
      {brief.isError ? (
        <DataUnavailable
          title="Executive brief unavailable"
          reason={
            brief.error instanceof Error
              ? brief.error.message
              : "The intelligence service did not respond. No figures are shown, because none were received."
          }
        />
      ) : null}

      {brief.data ? (
        <div className="space-y-4">
          {/* STALE / INCOMPLETE — stated before anything is read, not after. */}
          {brief.data.state !== "GENERATED" ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-[var(--color-biz-danger)]/30 bg-[var(--color-biz-danger)]/5 p-3"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-biz-danger)]" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--color-biz-danger)]">
                  This brief is {brief.data.state}
                </p>
                {brief.data.staleSources.length > 0 ? (
                  <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                    Stale at generation: {brief.data.staleSources.join(", ")}
                  </p>
                ) : null}
                {brief.data.unavailableSources.length > 0 ? (
                  <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                    Did not answer: {brief.data.unavailableSources.join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* The deterministic narrative, labelled as such so nobody mistakes it for a model's view. */}
          <p className="text-xs leading-relaxed text-[var(--color-biz-muted)]">
            {brief.data.narrative.text}
          </p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-biz-faint)]">
            Narrative: {brief.data.narrative.generatedBy === "DETERMINISTIC"
              ? "generated from the measured items, without a language model"
              : "written by a language model from the measured items"}
          </p>

          {/*
            Domains the platform never built. Separated from failures on purpose — an executive who
            reads eight permanent gaps as eight things that broke this morning will stop reading.
          */}
          {brief.data.structuralGaps.length > 0 ? (
            <details className="rounded-xl border border-dashed border-[var(--color-biz-line)] p-3">
              <summary className="cursor-pointer text-xs font-medium text-[var(--color-biz-muted)]">
                <Info className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                {brief.data.structuralGaps.length} domain(s) are not implemented on this platform
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-[var(--color-biz-faint)]">
                {brief.data.structuralGaps.map((g) => <li key={g}>{g}</li>)}
              </ul>
            </details>
          ) : null}

          {KIND_ORDER.map((kind) => (
            <KindSection key={kind} kind={kind} items={grouped.get(kind) ?? []} />
          ))}

          {/* Decisions nobody has made. Carried into the console rather than left in a document. */}
          {brief.data.humanDecisions.length > 0 ? (
            <section aria-labelledby="brief-decisions" className="min-w-0">
              <h3 id="brief-decisions" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
                Awaiting a human decision
              </h3>
              <ul className="mt-1.5 space-y-1">
                {brief.data.humanDecisions.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-[11px] text-[var(--color-biz-muted)]">
                    <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="break-words">{d}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
