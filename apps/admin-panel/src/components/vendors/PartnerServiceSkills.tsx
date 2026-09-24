"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, BadgeX, ClipboardList, Search } from "lucide-react";
import { adminApi, type PartnerServiceSkillCard } from "@/services/admin-api";
import { getErrorMessage } from "@/lib/api-error";

type Decision = { service: PartnerServiceSkillCard; action: "approve" | "suspend" | "revoke" };

export function PartnerServiceSkills({ providerId }: { providerId: string }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ["admin", "service-skills", providerId],
    queryFn: () => adminApi.serviceSkills.board(providerId),
    enabled: !!providerId,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin", "service-skills", providerId] });
    await qc.invalidateQueries({ queryKey: ["admin", "service-skill-requests"] });
    await qc.invalidateQueries({ queryKey: ["admin", "provider-detail", providerId] });
  };

  const decide = useMutation({
    mutationFn: (input: { serviceId: string; action: "approve" | "suspend" | "revoke"; reason?: string }) =>
      adminApi.serviceSkills.decide(providerId, input.serviceId, input.action, input.reason),
    onSuccess: async () => {
      setDecision(null);
      setReason("");
      setPicked("");
      setError(null);
      await refresh();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const data = board.data;
  const match = (items: PartnerServiceSkillCard[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => s.name.toLowerCase().includes(q) || s.slug.includes(q) || s.category.toLowerCase().includes(q));
  };
  const performing = useMemo(() => match(data?.performing ?? []), [data?.performing, query]);
  const pending = useMemo(() => match(data?.pending ?? []), [data?.pending, query]);
  const suspended = useMemo(() => match(data?.suspended ?? []), [data?.suspended, query]);
  const available = useMemo(() => match(data?.available ?? []), [data?.available, query]);

  const submitDecision = () => {
    if (!decision) return;
    if (decision.action !== "approve" && reason.trim().length < 3) {
      setError("Write a reason of at least 3 characters.");
      return;
    }
    setError(null);
    decide.mutate({ serviceId: decision.service.serviceId, action: decision.action, reason: reason.trim() || undefined });
  };

  return (
    <section className="biz-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <ClipboardList className="h-4 w-4 text-[var(--color-biz-accent)]" /> Service skills
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-biz-muted)]">
            Add any catalogue service to this partner. It goes live immediately. A request the partner sent waits until you approve it.
          </p>
        </div>
        <Link href="/vendors/skills" className="text-xs font-semibold text-[var(--color-biz-accent)]">
          Approval queue
        </Link>
      </div>

      {board.isLoading ? <p className="text-sm text-[var(--color-biz-muted)]">Loading skills…</p> : null}
      {board.isError ? <p className="text-sm text-red-400">Could not load service skills.</p> : null}
      {error ? <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p> : null}

      {data ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
            <h3 className="text-sm font-semibold">Add a service</h3>
            <p className="mt-1 text-xs text-[var(--color-biz-muted)]">This grants the skill immediately. The partner does not have to request it first.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className="min-w-[220px] flex-1 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
              >
                <option value="">Choose a service</option>
                {available.slice(0, 80).map((s) => (
                  <option key={s.serviceId} value={s.serviceId}>{s.name} · {s.category}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!picked || decide.isPending}
                onClick={() => {
                  const service = available.find((s) => s.serviceId === picked);
                  if (!service) return;
                  setDecision({ service, action: "approve" });
                  setReason("");
                  setError(null);
                }}
                className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Grant skill
              </button>
              {available.length === 0 ? (
                <p className="w-full text-xs text-[var(--color-biz-muted)]">
                  {query.trim() ? "No catalogue service matches that search." : "Nothing left to grant. This partner already performs every active catalogue service. Search below to see what they already have."}
                </p>
              ) : null}
            </div>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-biz-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills, for example spa"
              className="w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent py-2 pl-8 pr-3 text-sm"
            />
          </label>
          <SkillLane
            title="Performing now"
            empty="No services on this partner yet."
            items={performing}
            secondary={{ label: "Remove", onClick: (service) => { setDecision({ service, action: "suspend" }); setReason(""); setError(null); } }}
          />
          <SkillLane
            title="Waiting for your approval"
            empty="No open requests."
            items={pending}
            action={{ label: "Approve", tone: "good", onClick: (service) => { setDecision({ service, action: "approve" }); setReason(""); setError(null); } }}
            secondary={{ label: "Reject", onClick: (service) => { setDecision({ service, action: "revoke" }); setReason(""); setError(null); } }}
          />
          <SkillLane
            title="Suspended"
            empty="None."
            items={suspended}
            action={{ label: "Restore", tone: "good", onClick: (service) => { setDecision({ service, action: "approve" }); setReason(""); setError(null); } }}
          />

        </div>
      ) : null}

      {decision ? (
        <div className="mt-4 rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] p-4">
          <p className="text-sm font-semibold">
            {decision.action === "approve" ? "Approve" : decision.action === "suspend" ? "Suspend" : "Reject"} {decision.service.name}
          </p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
            {decision.action === "approve"
              ? "Offers for this service can reach this partner after you confirm."
              : "This partner will stop receiving new offers for this service."}
          </p>
          {decision.service.requestNote ? <p className="mt-2 text-xs">Partner note: {decision.service.requestNote}</p> : null}
          {decision.action !== "approve" ? (
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              className="mt-3 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
              rows={2}
            />
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={submitDecision} disabled={decide.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-biz-accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              <BadgeCheck className="h-3.5 w-3.5" /> Confirm
            </button>
            <button type="button" onClick={() => setDecision(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-semibold">
              <BadgeX className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SkillLane({
  title,
  empty,
  items,
  action,
  secondary,
}: {
  title: string;
  empty: string;
  items: PartnerServiceSkillCard[];
  action?: { label: string; tone: "good"; onClick: (service: PartnerServiceSkillCard) => void };
  secondary?: { label: string; onClick: (service: PartnerServiceSkillCard) => void };
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title} <span className="font-normal text-[var(--color-biz-muted)]">({items.length})</span></h3>
      {items.length === 0 ? <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{empty}</p> : (
        <ul className="mt-2 flex max-h-64 flex-wrap gap-2 overflow-auto">
          {items.map((s) => (
            <li key={s.serviceId} className="flex items-center gap-2 rounded-full border border-[var(--color-biz-line)] px-3 py-1 text-xs">
              <span>{s.name}</span>
              {action ? <button type="button" className="font-semibold text-emerald-400" onClick={() => action.onClick(s)}>{action.label}</button> : null}
              {secondary ? <button type="button" className="font-semibold text-red-400" onClick={() => secondary.onClick(s)}>{secondary.label}</button> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
