"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Clock, Headphones, Loader2, Search, Send, ShieldAlert } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { adminApi } from "@/services/admin-api";
import { cn } from "@/lib/cn";
import {
  SUPPORT_ANALYTICS_STALE_MS,
  SUPPORT_DETAIL_POLL_MS,
  SUPPORT_TICKETS_POLL_MS,
} from "@/lib/query-polling";
import { fingerprintJson, visiblePollInterval } from "@/lib/stable-query";

const ticketListHashes = new Map<string, string>();

export default function SupportPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [mergeId, setMergeId] = useState("");

  const queryParams = useMemo(
    () => ({
      limit: 50,
      search: search.trim() || undefined,
      status: status && status !== "all" ? status : undefined,
      assigned: status === "" ? "open" : undefined,
    }),
    [search, status],
  );

  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "support", "tickets", queryParams],
    queryFn: async () => {
      const fresh = await adminApi.support.tickets(queryParams);
      const cacheKey = JSON.stringify(queryParams);
      const hash = fingerprintJson(fresh);
      if (ticketListHashes.get(cacheKey) === hash) {
        const cached = qc.getQueryData<Awaited<ReturnType<typeof adminApi.support.tickets>>>([
          "admin",
          "support",
          "tickets",
          queryParams,
        ]);
        if (cached) return cached;
      }
      ticketListHashes.set(cacheKey, hash);
      return fresh;
    },
    staleTime: 30_000,
    refetchInterval: () => visiblePollInterval(SUPPORT_TICKETS_POLL_MS),
    refetchIntervalInBackground: false,
    notifyOnChangeProps: ["data", "error", "isLoading"],
  });
  const { data: analytics } = useQuery({
    queryKey: ["admin", "support", "analytics"],
    queryFn: () => adminApi.support.analytics(),
    staleTime: SUPPORT_ANALYTICS_STALE_MS,
    refetchInterval: false,
  });
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["admin", "support", "ticket", selectedId],
    queryFn: () => adminApi.support.ticketById(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: () => (selectedId ? visiblePollInterval(SUPPORT_DETAIL_POLL_MS) : false),
    refetchIntervalInBackground: false,
    notifyOnChangeProps: ["data", "error", "isLoading"],
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "support"] });
  };

  const respondMut = useMutation({
    mutationFn: () => adminApi.support.respond(selectedId!, reply),
    onSuccess: () => {
      setReply("");
      invalidate();
    },
  });
  const resolveMut = useMutation({
    mutationFn: () => adminApi.support.resolve(selectedId!, reply || "Resolved by support"),
    onSuccess: () => {
      setReply("");
      invalidate();
    },
  });
  const noteMut = useMutation({
    mutationFn: () => adminApi.support.respond(selectedId!, internalNote, true),
    onSuccess: () => {
      setInternalNote("");
      invalidate();
    },
  });
  const escalateMut = useMutation({
    mutationFn: () => adminApi.support.escalate(selectedId!, internalNote || undefined),
    onSuccess: () => invalidate(),
  });
  const mergeMut = useMutation({
    mutationFn: () => adminApi.support.merge(selectedId!, mergeId),
    onSuccess: () => {
      setMergeId("");
      invalidate();
    },
  });

  const a = analytics as {
    slaBreached?: number;
    avgResponseTimeMs?: number;
    openByPriority?: Record<string, number>;
    openTotal?: number;
  };

  const rows = (data?.tickets ?? []).map((t) => [
    <button
      key={`${t.id}-btn`}
      type="button"
      onClick={() => setSelectedId(t.id)}
      className="text-left font-semibold text-primary hover:underline"
    >
      {t.ticketNumber}
    </button>,
    t.subject,
    t.source === "partner" ? (
      <span key="src" className="rounded-md bg-violet/15 px-2 py-0.5 text-[10px] font-bold uppercase text-violet">
        Partner
      </span>
    ) : (
      <span key="src" className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
        Customer
      </span>
    ),
    t.source === "partner" ? (t.providerName ?? t.user ?? "—") : (t.user ?? "—"),
    <StatusBadge key="p" status={t.priorityLevel} />,
    <StatusBadge key="s" status={t.status} />,
    t.slaBreached ? "Breached" : "On track",
    t.responseTimeMs ? `${Math.round(t.responseTimeMs / 60000)}m` : "—",
    new Date(t.createdAt).toLocaleString("en-IN"),
  ]);

  const ticket = detail;

  return (
    <PageShell
      title="Support Operations"
      subtitle="Respond, resolve, escalate, and audit the full ticket lifecycle"
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Open total" value={String(a?.openTotal ?? 0)} icon={Headphones} />
        <KpiCard label="High priority" value={String(a?.openByPriority?.high ?? 0)} icon={AlertCircle} />
        <KpiCard label="Normal open" value={String(a?.openByPriority?.normal ?? 0)} icon={Headphones} />
        <KpiCard label="SLA breached" value={String(a?.slaBreached ?? 0)} icon={AlertCircle} accent="red" />
        <KpiCard
          label="Avg response"
          value={a?.avgResponseTimeMs ? `${Math.round(a.avgResponseTimeMs / 60000)} min` : "—"}
          icon={Clock}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets…"
            className="h-10 w-full rounded-lg border border-line bg-transparent pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-lg border border-line bg-transparent px-3 text-sm"
        >
          <option value="">Open queue</option>
          <option value="all">All tickets</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <DataTable
          title="Tickets"
          columns={["Ticket", "Subject", "Source", "Requester", "Priority", "Status", "SLA", "Response", "Created"]}
          rows={rows}
          loading={isLoading}
          emptyMessage="No support tickets"
        />

        <div className="rounded-xl border border-line bg-surface/50 p-4">
          {!selectedId ? (
            <p className="py-12 text-center text-sm text-muted">Select a ticket to respond</p>
          ) : detailLoading || !ticket ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <TicketOpsPanel
              ticket={ticket}
              reply={reply}
              setReply={setReply}
              internalNote={internalNote}
              setInternalNote={setInternalNote}
              mergeId={mergeId}
              setMergeId={setMergeId}
              onRespond={() => respondMut.mutate()}
              onResolve={() => resolveMut.mutate()}
              onNote={() => noteMut.mutate()}
              onEscalate={() => escalateMut.mutate()}
              onMerge={() => mergeMut.mutate()}
              busy={
                respondMut.isPending ||
                resolveMut.isPending ||
                noteMut.isPending ||
                escalateMut.isPending ||
                mergeMut.isPending
              }
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}

function TicketOpsPanel({
  ticket,
  reply,
  setReply,
  internalNote,
  setInternalNote,
  mergeId,
  setMergeId,
  onRespond,
  onResolve,
  onNote,
  onEscalate,
  onMerge,
  busy,
}: {
  ticket: NonNullable<Awaited<ReturnType<typeof adminApi.support.ticketById>>>;
  reply: string;
  setReply: (v: string) => void;
  internalNote: string;
  setInternalNote: (v: string) => void;
  mergeId: string;
  setMergeId: (v: string) => void;
  onRespond: () => void;
  onResolve: () => void;
  onNote: () => void;
  onEscalate: () => void;
  onMerge: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="border-b border-line pb-3">
        <p className="text-xs text-muted">{ticket.ticketNumber}</p>
        <h3 className="font-semibold text-content">{ticket.subject}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {ticket.source === "partner" ? (
            <span className="rounded-md bg-violet/15 px-2 py-0.5 font-bold uppercase text-violet">
              Partner ticket
            </span>
          ) : (
            <span className="rounded-md bg-primary/15 px-2 py-0.5 font-bold uppercase text-primary">
              Customer ticket
            </span>
          )}
          <StatusBadge status={ticket.status} />
          <StatusBadge status={ticket.priorityLevel} />
        </div>
        <p className="mt-2 text-xs text-muted">
          {ticket.user ?? "—"} · {ticket.email ?? "—"} · {ticket.category}
          {ticket.providerName ? ` · ${ticket.providerName}` : ""}
        </p>
        {ticket.bookingNumber || ticket.bookingId ? (
          <p className="mt-1 text-xs text-muted">
            Booking:{" "}
            {ticket.bookingId ? (
              <a href={`/bookings/${ticket.bookingId}`} className="font-semibold text-primary hover:underline">
                {ticket.bookingNumber ?? ticket.bookingId}
              </a>
            ) : (
              ticket.bookingNumber
            )}
          </p>
        ) : null}
        {ticket.slaDueAt ? (
          <p className={cn("mt-1 text-xs", ticket.slaBreached ? "text-error" : "text-muted")}>
            SLA due: {new Date(ticket.slaDueAt).toLocaleString("en-IN")}
            {ticket.slaBreached ? " (breached)" : ""}
          </p>
        ) : null}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto py-3">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[95%] rounded-lg px-3 py-2 text-sm",
              m.isInternal
                ? "border border-amber-500/30 bg-amber-500/10 text-amber-200"
                : m.authorRole === "admin"
                  ? "ml-auto bg-primary/15 text-content"
                  : m.authorRole === "partner"
                    ? "bg-violet/10 text-content"
                    : "bg-line/30 text-content",
            )}
          >
            <p className="text-[10px] font-bold uppercase text-muted">
              {m.authorRole === "admin" ? "Support agent" : m.authorRole}
              {m.isInternal ? " · internal" : ""}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className="mt-1 text-[10px] text-muted">
              {new Date(m.createdAt).toLocaleString("en-IN")}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder="Reply to customer/partner…"
          className="w-full rounded-lg border border-line bg-transparent p-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !reply.trim()}
            onClick={onRespond}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            <Send className="h-3 w-3" /> Respond
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onResolve}
            className="rounded-lg bg-success/20 px-3 py-2 text-xs font-bold text-success"
          >
            Resolve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onEscalate}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-bold text-amber-400"
          >
            <ShieldAlert className="h-3 w-3" /> Escalate
          </button>
        </div>

        <textarea
          value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)}
          rows={2}
          placeholder="Internal note (not visible to user)…"
          className="w-full rounded-lg border border-line bg-transparent p-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || !internalNote.trim()}
          onClick={onNote}
          className="text-xs font-semibold text-muted underline"
        >
          Save internal note
        </button>

        <div className="flex gap-2 pt-2">
          <input
            value={mergeId}
            onChange={(e) => setMergeId(e.target.value)}
            placeholder="Duplicate ticket ID"
            className="h-9 flex-1 rounded-lg border border-line bg-transparent px-2 text-xs"
          />
          <button
            type="button"
            disabled={busy || !mergeId.trim()}
            onClick={onMerge}
            className="rounded-lg border border-line px-3 text-xs font-semibold"
          >
            Merge into this
          </button>
        </div>
      </div>
    </div>
  );
}
