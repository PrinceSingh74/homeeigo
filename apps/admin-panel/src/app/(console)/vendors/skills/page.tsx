"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ClipboardList, Search } from "lucide-react";
import { adminApi, type PartnerServiceSkillCard } from "@/services/admin-api";
import { getErrorMessage } from "@/lib/api-error";
import { formatDate } from "@/lib/format";

type PickedPartner = { id: string; name: string; city: string | null };

export default function ServiceSkillQueuePage() {
  const qc = useQueryClient();
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partner, setPartner] = useState<PickedPartner | null>(null);
  const [serviceQuery, setServiceQuery] = useState("");

  const queue = useQuery({
    queryKey: ["admin", "service-skill-requests"],
    queryFn: () => adminApi.serviceSkills.queue(),
  });

  const partnerSearch = useQuery({
    queryKey: ["admin", "providers", "skill-grant", partnerQuery.trim()],
    queryFn: () => adminApi.listProviders({ search: partnerQuery.trim(), limit: 40 }),
    enabled: partnerQuery.trim().length >= 2 && !partner,
  });

  const board = useQuery({
    queryKey: ["admin", "service-skills", partner?.id],
    queryFn: () => adminApi.serviceSkills.board(partner!.id),
    enabled: !!partner,
  });

  const decide = useMutation({
    mutationFn: (input: { providerId: string; serviceId: string; action: "approve" | "revoke"; reason?: string; serviceName?: string; partnerName?: string }) =>
      adminApi.serviceSkills.decide(input.providerId, input.serviceId, input.action, input.reason),
    onSuccess: async (_data, input) => {
      setReasonFor(null);
      setReason("");
      setError(null);
      if (input.action === "approve" && input.serviceName) {
        setNotice(`${input.serviceName} is live on ${input.partnerName ?? "this partner"}. Customers can be matched to them for it.`);
        setServiceQuery("");
      }
      await qc.invalidateQueries({ queryKey: ["admin", "service-skill-requests"] });
      await qc.invalidateQueries({ queryKey: ["admin", "service-skills"] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const requests = queue.data?.requests ?? [];
  const matches = useMemo(() => filterBoard(board.data, serviceQuery), [board.data, serviceQuery]);

  const grant = (service: PartnerServiceSkillCard) => {
    if (!partner) return;
    setError(null);
    setNotice(null);
    decide.mutate({
      providerId: partner.id,
      serviceId: service.serviceId,
      action: "approve",
      serviceName: service.name,
      partnerName: partner.name,
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]">
          <ClipboardList className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Service skills</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-biz-muted)]">
            You can put any catalogue service on any partner from here. It goes live immediately. A partner can also ask from My Services, and that request waits in the list below until you approve it.
          </p>
        </div>
      </header>

      {notice ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">{notice}</p> : null}
      {error ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      <section className="biz-card space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">Add a service to a partner</h2>
          <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
            Search the partner, then the service. Grant does not wait for a request.
          </p>
        </div>

        {partner ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-biz-line)] px-3 py-2">
            <div>
              <p className="font-semibold">{partner.name}</p>
              <p className="text-xs text-[var(--color-biz-muted)]">{partner.city || "No city"} · {board.data?.performing.length ?? "…"} services live</p>
            </div>
            <div className="flex gap-2">
              <Link href={`/vendors/${partner.id}`} className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-semibold">
                Open file
              </Link>
              <button
                type="button"
                onClick={() => { setPartner(null); setServiceQuery(""); setNotice(null); }}
                className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-semibold"
              >
                Change partner
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-biz-muted)]" />
              <input
                value={partnerQuery}
                onChange={(e) => setPartnerQuery(e.target.value)}
                placeholder="Search a partner, for example Rahul"
                className="w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent py-2 pl-8 pr-3 text-sm"
              />
            </label>
            {partnerQuery.trim().length > 0 && partnerQuery.trim().length < 2 ? (
              <p className="text-xs text-[var(--color-biz-muted)]">Type at least 2 letters.</p>
            ) : null}
            {partnerSearch.isFetching ? <p className="text-xs text-[var(--color-biz-muted)]">Searching partners…</p> : null}
            {partnerSearch.isError ? <p className="text-xs text-red-400">Could not search partners.</p> : null}
            <ul className="space-y-1">
              {(partnerSearch.data?.providers ?? []).map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => { setPartner({ id: row.id, name: row.name, city: row.city ?? null }); setNotice(null); setError(null); }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-biz-elevated)]"
                  >
                    <span className="font-semibold">{row.name}</span>
                    <span className="text-xs text-[var(--color-biz-muted)]">{row.city || "No city"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {partnerSearch.isSuccess && partnerQuery.trim().length >= 2 && (partnerSearch.data?.providers.length ?? 0) === 0 ? (
              <p className="text-xs text-[var(--color-biz-muted)]">No partner matches that name.</p>
            ) : null}
          </div>
        )}

        {partner ? (
          <div className="space-y-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-biz-muted)]" />
              <input
                value={serviceQuery}
                onChange={(e) => setServiceQuery(e.target.value)}
                placeholder="Search a service, for example spa"
                className="w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent py-2 pl-8 pr-3 text-sm"
              />
            </label>
            {board.isLoading ? <p className="text-sm text-[var(--color-biz-muted)]">Loading this partner&apos;s skills…</p> : null}
            {board.isError ? <p className="text-sm text-red-400">Could not load this partner&apos;s skills.</p> : null}
            <ul className="space-y-2">
              {matches.map((service) => (
                <li key={service.serviceId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-biz-line)] px-3 py-2">
                  <div>
                    <p className="font-semibold">{service.name}</p>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-biz-muted)]">{service.category}</p>
                  </div>
                  {service.lane === "available" || service.lane === "suspended" || service.lane === "revoked" ? (
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => grant(service)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <BadgeCheck className="h-3.5 w-3.5" /> {service.lane === "available" ? "Grant skill" : "Restore"}
                    </button>
                  ) : service.lane === "pending" ? (
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => grant(service)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <BadgeCheck className="h-3.5 w-3.5" /> Approve
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-400">Already on this partner</span>
                  )}
                </li>
              ))}
            </ul>
            {board.isSuccess && matches.length === 0 ? (
              <p className="text-sm text-[var(--color-biz-muted)]">
                {serviceQuery.trim()
                  ? "No catalogue service matches that search."
                  : "This partner already performs every active catalogue service. Search a name to confirm, or publish a new service and grant it here."}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Waiting for your approval</h2>
        <p className="text-sm text-[var(--color-biz-muted)]">
          These came from a partner&apos;s My Services page. Nothing is offered to customers until you approve. Rejecting keeps their existing skills.
        </p>
        {queue.isLoading ? <p className="text-sm text-[var(--color-biz-muted)]">Loading requests…</p> : null}
        {queue.isError ? <p className="text-sm text-red-400">Could not load the queue.</p> : null}
        {!queue.isLoading && !queue.isError && requests.length === 0 ? (
          <p className="biz-card p-5 text-sm text-[var(--color-biz-muted)]">
            No partner requests are waiting. Use the form above when you want to add a service yourself.
          </p>
        ) : null}
        <ul className="space-y-3">
          {requests.map((row) => (
            <li key={row.capabilityId} className="biz-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{row.serviceName}</p>
                  <p className="text-sm text-[var(--color-biz-muted)]">
                    {row.partnerName}{row.city ? ` · ${row.city}` : ""} · {row.category} · asked {formatDate(row.requestedAt)}
                  </p>
                  {row.requestNote ? <p className="mt-2 text-sm">“{row.requestNote}”</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/vendors/${row.providerId}`} className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-semibold">
                    Open partner
                  </Link>
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ providerId: row.providerId, serviceId: row.serviceId, action: "approve", serviceName: row.serviceName, partnerName: row.partnerName })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <BadgeCheck className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => { setReasonFor(String(row.capabilityId)); setReason(""); setError(null); }}
                    className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-400"
                  >
                    Reject
                  </button>
                </div>
              </div>
              {reasonFor === String(row.capabilityId) ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why this skill is rejected"
                    rows={2}
                    className="min-w-[240px] flex-1 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={decide.isPending || reason.trim().length < 3}
                    onClick={() => decide.mutate({ providerId: row.providerId, serviceId: row.serviceId, action: "revoke", reason: reason.trim() })}
                    className="rounded-lg bg-red-500/90 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Confirm reject
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function filterBoard(
  board: { available: PartnerServiceSkillCard[]; performing: PartnerServiceSkillCard[]; pending: PartnerServiceSkillCard[]; suspended: PartnerServiceSkillCard[]; revoked: PartnerServiceSkillCard[] } | undefined,
  query: string,
): PartnerServiceSkillCard[] {
  if (!board) return [];
  const q = query.trim().toLowerCase();
  const pool = q
    ? [...board.available, ...board.pending, ...board.suspended, ...board.revoked, ...board.performing]
    : board.available;
  const matched = pool.filter((service) => !q || service.name.toLowerCase().includes(q) || service.slug.includes(q) || service.category.toLowerCase().includes(q));
  return matched.slice(0, 24);
}
