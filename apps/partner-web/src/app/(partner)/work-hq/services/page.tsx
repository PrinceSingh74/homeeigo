"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CircleAlert, CircleCheck, ClipboardList, Clock, ListTodo } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { describeReadiness, summarizeReadiness } from "@/lib/service-readiness";
import { partnerApi, type PartnerServiceSkillCard } from "@/services/partner-api";

export default function PartnerServicesPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  // null = the partner has not chosen: the lane opens by itself when a service needs attention.
  const [showPerforming, setShowPerforming] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ["partner", "service-skills"],
    queryFn: () => partnerApi.serviceSkills(),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["partner", "service-skills"] });

  const request = useMutation({
    mutationFn: (serviceId: string) => partnerApi.requestServiceSkill(serviceId, note.trim() || undefined),
    onSuccess: async () => {
      setNote("");
      setMessage("Request sent. An admin has to approve it before customers can book you for this service.");
      setError(null);
      await refresh();
    },
    onError: (err: Error) => setError(err.message || "Could not send the request."),
  });

  const withdraw = useMutation({
    mutationFn: (capabilityId: number) => partnerApi.withdrawServiceSkill(capabilityId),
    onSuccess: async () => {
      setMessage("Request withdrawn.");
      setError(null);
      await refresh();
    },
    onError: (err: Error) => setError(err.message || "Could not withdraw the request."),
  });

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board.data?.available ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));
  }, [board.data?.available, query]);

  const data = board.data;
  // Null when the server reports no readiness (older backend): then no readiness UI at all.
  const readiness = summarizeReadiness(data?.performing ?? []);
  const performingOpen = showPerforming ?? (readiness?.notReady ?? 0) > 0;

  return (
    <HqPageShell
      title="My Services"
      description="Ask for any catalogue service you can now do. It stays off customer bookings until an admin approves it. Services you already perform stay on your account."
      icon={ClipboardList}
      loading={board.isLoading}
      error={board.isError ? "Could not load your services." : null}
      onRetry={() => void board.refetch()}
    >
      {message ? <p className="rounded-xl border border-partner-line bg-partner-primary/10 px-4 py-3 text-sm">{message}</p> : null}
      {error ? <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p> : null}
      {readiness?.sentence ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-partner-line bg-partner-warning/10 px-4 py-3 text-sm text-partner-text" data-testid="readiness-summary">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-partner-warning" aria-hidden="true" />
          <span>
            <span className="font-semibold">{readiness.sentence}</span> Each one below lists what is missing.
          </span>
        </p>
      ) : null}
      {data && !data.approvalWorkflow ? (
        <p className="text-sm text-partner-muted">New skill requests are not available on this server yet. Your signup services are unchanged.</p>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Add a service you can now do</h2>
        <p className="text-sm text-partner-muted">Search the catalogue and send a request. An admin approves it before customers can book you for that service.</p>
        <label className="block text-sm">
          <span className="text-partner-muted">Why you are ready for this skill</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Example: completed spa training this month"
            className="mt-1 w-full rounded-lg border border-partner-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search services, for example spa"
          className="w-full rounded-lg border border-partner-line bg-transparent px-3 py-2 text-sm"
        />
        <div className="grid gap-3">
          {available.slice(0, 40).map((s) => (
            <article key={s.serviceId} className="partner-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h3 className="font-semibold">{s.name}</h3>
                <p className="text-xs uppercase tracking-wide text-partner-muted">{s.category}</p>
              </div>
              <button
                type="button"
                disabled={request.isPending || data?.approvalWorkflow === false}
                onClick={() => request.mutate(s.serviceId)}
                className="min-h-11 rounded-xl bg-partner-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Request approval
              </button>
            </article>
          ))}
          {available.length === 0 && !board.isLoading ? (
            <p className="text-sm text-partner-muted">
              {query.trim() ? "No services match that search." : "Every catalogue service is already on your account. A newly published service shows up here so you can request it."}
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Services you perform ({data?.performing.length ?? 0})</h2>
          <button
            type="button"
            onClick={() => setShowPerforming(!performingOpen)}
            aria-expanded={performingOpen}
            className="min-h-11 rounded-lg border border-partner-line px-4 text-sm font-semibold"
          >
            {performingOpen ? "Hide" : "Show"}
          </button>
        </div>
        {performingOpen ? <PerformingLane items={data?.performing ?? []} /> : null}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Waiting for approval</h2>
        {(data?.pending.length ?? 0) === 0 ? <p className="text-sm text-partner-muted">No open requests.</p> : null}
        <div className="grid gap-3">
          {(data?.pending ?? []).map((s) => (
            <article key={s.serviceId} className="partner-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h3 className="font-semibold">{s.name}</h3>
                <p className="text-sm text-partner-muted">{s.category} · pending admin review</p>
                {s.requestNote ? <p className="mt-1 text-sm">{s.requestNote}</p> : null}
              </div>
              {s.capabilityId != null ? (
                <button
                  type="button"
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate(s.capabilityId!)}
                  className="min-h-11 rounded-lg border border-partner-line px-4 text-sm font-semibold"
                >
                  Withdraw
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {(data?.suspended.length ?? 0) > 0 ? (
        <Lane title="Paused by admin" empty="" items={data?.suspended ?? []} hint="These services are not offered until an admin restores them." />
      ) : null}
    </HqPageShell>
  );
}

/**
 * Services the partner performs, each with whether it is actually being matched. Being authorised
 * for a service is not the same as being offered its jobs: a requirement the partner does not meet
 * silently removes them from matching, so each gap is said in a sentence with its next step.
 */
function PerformingLane({ items }: { items: PartnerServiceSkillCard[] }) {
  if (items.length === 0) return <p className="text-sm text-partner-muted">No services yet. Finish onboarding first.</p>;
  return (
    <div className="grid gap-3">
      {items.map((s) => {
        const lines = describeReadiness(s.readiness);
        return (
          <article key={s.serviceId} className="partner-card space-y-3 p-4" data-testid="performing-service" data-ready={s.readiness ? s.readiness.ready : undefined}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="font-display text-lg font-semibold">{s.name}</h3>
              <span className="text-xs uppercase tracking-wide text-partner-muted">{s.category}</span>
            </div>
            {!s.readiness ? null : s.readiness.ready ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-partner-text" data-testid="service-ready">
                <CircleCheck className="h-4 w-4 shrink-0 text-partner-success" aria-hidden="true" />
                Ready for jobs
              </p>
            ) : (
              <div className="space-y-2" data-testid="service-not-ready">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
                  <CircleAlert className="h-4 w-4 shrink-0 text-partner-warning" aria-hidden="true" />
                  Not being offered jobs yet
                </p>
                <ul className="space-y-2" aria-label={`What ${s.name} still needs`}>
                  {lines.map((line, i) => (
                    <li key={i} className="rounded-xl border border-partner-line p-3">
                      <p className="flex items-start gap-2 text-sm text-partner-text-secondary">
                        {line.waiting ? (
                          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-partner-muted" aria-hidden="true" />
                        ) : (
                          <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
                        )}
                        <span>
                          <span className="font-semibold text-partner-text">{line.waiting ? "Waiting on us: " : line.step ? "To do: " : "Note: "}</span>
                          {line.sentence}
                        </span>
                      </p>
                      {line.step ? (
                        <Link
                          href={line.step.href}
                          aria-label={`${line.step.label} — for ${s.name}`}
                          className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-partner-line px-4 text-sm font-semibold text-partner-text transition hover:border-partner-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary"
                        >
                          {line.step.label}
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Lane({ title, empty, items, hint }: { title: string; empty: string; items: PartnerServiceSkillCard[]; hint?: string }) {
  return (
    <section className="space-y-3">
      {title ? <h2 className="font-display text-lg font-semibold">{title}</h2> : null}
      {hint ? <p className="text-sm text-partner-muted">{hint}</p> : null}
      {items.length === 0 ? <p className="text-sm text-partner-muted">{empty}</p> : null}
      <div className="grid gap-3">
        {items.map((s) => (
          <article key={s.serviceId} className="partner-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-lg font-semibold">{s.name}</h3>
              <span className="text-xs uppercase tracking-wide text-partner-muted">{s.category}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
