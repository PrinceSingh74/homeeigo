"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Shield,
} from "lucide-react";
import {
  useCreateSupportTicketMutation,
  useSupportReplyMutation,
  useSupportTicketQuery,
  useSupportTicketsQuery,
} from "@/hooks/use-support";
import { getErrorMessage } from "@/lib/auth/errors";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "Booking issue",
  "Payment & refunds",
  "Wallet & rewards",
  "Account & login",
  "Service quality",
  "Other",
];

const STATUS_STYLE: Record<string, string> = {
  open: "bg-warning/15 text-warning",
  in_progress: "bg-primary/15 text-primary",
  resolved: "bg-success/15 text-success",
  closed: "bg-line text-muted",
};

function formatSlaDue(slaDueAt: string | null) {
  if (!slaDueAt) return null;
  const due = new Date(slaDueAt);
  const diff = due.getTime() - Date.now();
  if (diff <= 0) return "SLA overdue";
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 24) return `Response due in ${hours}h`;
  return `Response due ${due.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}

export function SupportCenter({ initialTicketId }: { initialTicketId?: string | null } = {}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "all">("open");
  const [selectedId, setSelectedId] = useState<string | null>(initialTicketId ?? null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (initialTicketId) setSelectedId(initialTicketId);
  }, [initialTicketId]);

  const listParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      closed: statusFilter === "open" ? "false" : statusFilter === "closed" ? "true" : undefined,
      limit: 50,
      page: 1,
    }),
    [search, statusFilter],
  );

  const ticketsQuery = useSupportTicketsQuery(listParams);
  const tickets = ticketsQuery.data?.tickets ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              className="h-11 w-full rounded-xl border border-line bg-transparent pl-9 pr-3 text-sm text-content outline-none focus:border-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            New ticket
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["open", "closed", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition",
                statusFilter === f
                  ? "bg-primary text-white"
                  : "border border-line text-muted hover:text-content",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {ticketsQuery.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your tickets…
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line py-12 text-center">
            <MessageSquare className="mx-auto h-10 w-10 text-muted" />
            <p className="mt-3 font-semibold text-content">No tickets yet</p>
            <p className="mt-1 text-sm text-muted">
              Raise a ticket for bookings, payments, or account help — we respond fast.
            </p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white"
            >
              Create ticket
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    "w-full rounded-2xl border p-4 text-left transition",
                    selectedId === t.id
                      ? "border-primary bg-primary/5"
                      : "border-line hover:border-primary/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-content">{t.subject}</p>
                      <p className="mt-0.5 text-xs text-muted">{t.ticketNumber}</p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase",
                        STATUS_STYLE[t.status] ?? STATUS_STYLE.open,
                      )}
                    >
                      {t.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span>{t.category}</span>
                    {t.priorityLevel === "high" ? (
                      <span className="flex items-center gap-1 text-violet">
                        <Shield className="h-3 w-3" /> Priority
                      </span>
                    ) : null}
                    {t.slaBreached ? (
                      <span className="flex items-center gap-1 text-error">
                        <AlertCircle className="h-3 w-3" /> SLA breached
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(t.createdAt).toLocaleDateString("en-IN")}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        {selectedId ? (
          <TicketDetailPanel ticketId={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-line p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-muted" />
            <p className="mt-3 text-sm text-muted">Select a ticket to view the conversation</p>
            <p className="mt-1 text-xs text-muted">
              Replies from our support team appear here in real time
            </p>
          </div>
        )}
      </div>

      {showCreate ? <CreateTicketModal onClose={() => setShowCreate(false)} /> : null}
    </div>
  );
}

function TicketDetailPanel({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const { data: ticket, isLoading, isError, refetch } = useSupportTicketQuery(ticketId);
  const reply = useSupportReplyMutation();
  const [replyBody, setReplyBody] = useState("");

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-line">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="rounded-2xl border border-line p-6">
        <p className="text-sm text-error">Could not load ticket.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 text-sm font-semibold text-primary underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const closed = ticket.status === "closed";
  const resolved = ticket.status === "resolved";
  const slaLabel = formatSlaDue(ticket.slaDueAt);

  return (
    <div className="flex max-h-[72vh] flex-col overflow-hidden rounded-2xl border border-line">
      <div className="border-b border-line p-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 text-xs font-semibold text-primary lg:hidden"
        >
          ← Back to list
        </button>
        <p className="text-xs text-muted">{ticket.ticketNumber}</p>
        <h2 className="font-display text-lg font-bold text-content">{ticket.subject}</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 font-bold uppercase",
              STATUS_STYLE[ticket.status] ?? STATUS_STYLE.open,
            )}
          >
            {ticket.status.replace("_", " ")}
          </span>
          <span className="rounded-md bg-line/50 px-2 py-0.5 text-muted">{ticket.category}</span>
          {slaLabel && !resolved && !closed ? (
            <span
              className={cn(
                "rounded-md px-2 py-0.5",
                ticket.slaBreached ? "bg-error/10 text-error" : "bg-primary/10 text-primary",
              )}
            >
              {slaLabel}
            </span>
          ) : null}
        </div>
        {ticket.bookingId ? (
          <Link
            href={`/bookings?focus=${encodeURIComponent(ticket.bookingId)}`}
            className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
          >
            View linked booking
          </Link>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[90%] rounded-xl px-3 py-2 text-sm",
              m.authorRole === "admin"
                ? "ml-auto bg-primary/15 text-content"
                : m.authorRole === "partner"
                  ? "bg-violet/10 text-content"
                  : "bg-line/40 text-content",
            )}
          >
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">
              {m.authorRole === "admin" ? "HOMEEIGO Support" : m.authorRole}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className="mt-1 text-[10px] text-muted">
              {new Date(m.createdAt).toLocaleString("en-IN")}
            </p>
          </div>
        ))}
        {ticket.attachments.length > 0 ? (
          <div className="rounded-lg border border-line p-3 text-xs text-muted">
            <Paperclip className="mb-1 inline h-3 w-3" /> {ticket.attachments.length} attachment(s)
          </div>
        ) : null}
        {resolved && ticket.resolution ? (
          <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
            <p className="text-[10px] font-bold uppercase">Resolution</p>
            <p className="mt-1 whitespace-pre-wrap">{ticket.resolution}</p>
            <p className="mt-2 text-xs text-muted">
              Reply below to reopen if you need more help.
            </p>
          </div>
        ) : null}
      </div>

      {!closed ? (
        <div className="border-t border-line p-4">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={3}
            placeholder={resolved ? "Need more help? Reply to reopen…" : "Write a reply…"}
            className="w-full resize-none rounded-xl border border-line bg-transparent p-3 text-sm text-content outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={replyBody.trim().length < 1 || reply.isPending}
            onClick={() => {
              const body = replyBody.trim();
              if (!body) return;
              reply.mutate({ id: ticketId, body }, { onSuccess: () => setReplyBody("") });
            }}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {reply.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send reply
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CreateTicketModal({ onClose }: { onClose: () => void }) {
  const create = useCreateSupportTicketMutation();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-primary";

  const submit = () => {
    setError(null);
    if (subject.trim().length < 3) return setError("Subject must be at least 3 characters.");
    if (description.trim().length < 10)
      return setError("Please describe your issue in at least 10 characters.");
    create.mutate(
      {
        subject: subject.trim(),
        description: description.trim(),
        category,
        bookingId: bookingId.trim() || undefined,
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(getErrorMessage(err)),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-canvas p-5 shadow-xl">
        <h3 className="font-display text-lg font-bold text-content">New support ticket</h3>
        <p className="mt-1 text-sm text-muted">
          Our team typically responds within 2 hours for priority members.
        </p>
        <div className="mt-4 space-y-3">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            maxLength={200}
            className={inputClass}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Describe your issue in detail…"
            className={inputClass}
          />
          <input
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
            placeholder="Booking reference (optional, e.g. HOMEEIGO-20260613-00001)"
            className={inputClass}
          />
        </div>
        {error ? <p className="mt-2 text-sm text-error">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-line py-2.5 text-sm font-semibold text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={create.isPending}
            onClick={submit}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {create.isPending ? "Submitting…" : "Submit ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
