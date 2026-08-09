"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import {
  useCreatePartnerSupportTicketMutation,
  usePartnerSupportReplyMutation,
  usePartnerSupportTicketQuery,
  usePartnerSupportTicketsQuery,
} from "@/hooks/use-partner-support";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

const CATEGORIES = [
  "Payout issue",
  "Booking dispute",
  "Account & verification",
  "App & technical",
  "Policy question",
  "Other",
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High priority" },
];

const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-400",
  in_progress: "bg-partner-primary/15 text-partner-primary",
  resolved: "bg-partner-success/15 text-partner-success",
  closed: "bg-partner-muted/20 text-partner-muted",
};

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
    }),
    [search, statusFilter],
  );

  const ticketsQuery = usePartnerSupportTicketsQuery(listParams);
  const tickets = ticketsQuery.data?.tickets ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-partner-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              className="h-10 w-full rounded-lg border border-partner-line bg-partner-surface pl-9 pr-3 text-sm text-partner-text outline-none focus:border-partner-primary"
            />
          </div>
          <PartnerButton onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            New ticket
          </PartnerButton>
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
                  ? "bg-partner-primary text-white"
                  : "bg-partner-surface text-partner-muted hover:text-partner-text",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {ticketsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-partner-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tickets…
          </div>
        ) : tickets.length === 0 ? (
          <PartnerCard className="p-8 text-center">
            <MessageSquare className="mx-auto h-10 w-10 text-partner-muted" />
            <p className="mt-3 font-semibold text-partner-text">No tickets yet</p>
            <p className="mt-1 text-sm text-partner-muted">
              Create a ticket for payouts, disputes, or account help.
            </p>
            <PartnerButton className="mt-4" onClick={() => setShowCreate(true)}>
              Create ticket
            </PartnerButton>
          </PartnerCard>
        ) : (
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    "w-full rounded-xl border p-4 text-left transition",
                    selectedId === t.id
                      ? "border-partner-primary bg-partner-primary/10"
                      : "border-partner-line bg-partner-surface hover:border-partner-primary/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-partner-text">{t.subject}</p>
                      <p className="mt-0.5 text-xs text-partner-muted">{t.ticketNumber}</p>
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
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-partner-muted">
                    <span>{t.category}</span>
                    <span className="capitalize">{t.priorityLevel} priority</span>
                    {t.slaBreached ? (
                      <span className="flex items-center gap-1 text-partner-danger">
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
          <PartnerCard className="flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-partner-muted" />
            <p className="mt-3 text-sm text-partner-muted">Select a ticket to view the thread</p>
          </PartnerCard>
        )}
      </div>

      {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function TicketDetailPanel({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const { data: ticket, isLoading, isError, refetch } = usePartnerSupportTicketQuery(ticketId);
  const reply = usePartnerSupportReplyMutation();
  const [replyBody, setReplyBody] = useState("");

  if (isLoading) {
    return (
      <PartnerCard className="flex min-h-[320px] items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-partner-primary" />
      </PartnerCard>
    );
  }

  if (isError || !ticket) {
    return (
      <PartnerCard className="p-6">
        <p className="text-sm text-partner-danger">Could not load ticket.</p>
        <PartnerButton variant="outline" className="mt-3" onClick={() => void refetch()}>
          Retry
        </PartnerButton>
      </PartnerCard>
    );
  }

  const closed = ticket.status === "closed";
  const resolved = ticket.status === "resolved";

  return (
    <PartnerCard className="flex max-h-[70vh] flex-col overflow-hidden">
      <div className="border-b border-partner-line p-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 text-xs font-semibold text-partner-primary lg:hidden"
        >
          ← Back to list
        </button>
        <p className="text-xs text-partner-muted">{ticket.ticketNumber}</p>
        <h2 className="font-display text-lg font-bold text-partner-text">{ticket.subject}</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className={cn("rounded-md px-2 py-0.5 font-bold uppercase", STATUS_STYLE[ticket.status])}>
            {ticket.status}
          </span>
          <span className="rounded-md bg-partner-surface px-2 py-0.5 text-partner-muted">
            {ticket.category}
          </span>
        </div>
      </div>

      <div className="partner-scroll flex-1 space-y-3 overflow-y-auto p-4">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[90%] rounded-xl px-3 py-2 text-sm",
              m.authorRole === "admin"
                ? "ml-auto bg-partner-primary/20 text-partner-text"
                : "bg-partner-surface text-partner-text-secondary",
            )}
          >
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-partner-muted">
              {m.authorRole}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className="mt-1 text-[10px] text-partner-muted">
              {new Date(m.createdAt).toLocaleString("en-IN")}
            </p>
          </div>
        ))}
        {ticket.attachments.length > 0 && (
          <div className="rounded-lg border border-partner-line p-3 text-xs text-partner-muted">
            <Paperclip className="mb-1 inline h-3 w-3" /> {ticket.attachments.length} attachment(s)
          </div>
        )}
        {resolved && ticket.resolution ? (
          <div className="rounded-xl border border-partner-success/30 bg-partner-success/10 p-3 text-sm text-partner-success">
            <p className="text-[10px] font-bold uppercase">Resolution</p>
            <p className="mt-1 whitespace-pre-wrap">{ticket.resolution}</p>
            <p className="mt-2 text-xs text-partner-muted">Reply below to reopen if you need more help.</p>
          </div>
        ) : null}
      </div>

      {!closed && (
        <div className="border-t border-partner-line p-4">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={3}
            placeholder={resolved ? "Need more help? Reply to reopen…" : "Write a reply…"}
            className="w-full resize-none rounded-lg border border-partner-line bg-transparent p-3 text-sm text-partner-text outline-none focus:border-partner-primary"
          />
          <PartnerButton
            className="mt-2 w-full"
            disabled={replyBody.trim().length < 1 || reply.isPending}
            onClick={() => {
              const body = replyBody.trim();
              if (!body) return;
              reply.mutate({ id: ticketId, body }, { onSuccess: () => setReplyBody("") });
            }}
          >
            {reply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send reply
          </PartnerButton>
        </div>
      )}
    </PartnerCard>
  );
}

function CreateTicketModal({ onClose }: { onClose: () => void }) {
  const create = useCreatePartnerSupportTicketMutation();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priorityLevel, setPriorityLevel] = useState("normal");
  const [description, setDescription] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [attachments, setAttachments] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (subject.trim().length < 3) return setError("Subject must be at least 3 characters.");
    if (description.trim().length < 10)
      return setError("Please describe your issue in at least 10 characters.");
    const att = attachments
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    create.mutate(
      {
        subject: subject.trim(),
        description: description.trim(),
        category,
        priorityLevel,
        bookingId: bookingId.trim() || undefined,
        attachments: att.length ? att : undefined,
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(getErrorMessage(err)),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <PartnerCard className="w-full max-w-lg p-5">
        <h3 className="font-display text-lg font-bold">New support ticket</h3>
        <div className="mt-4 space-y-3">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="h-10 w-full rounded-lg border border-partner-line bg-transparent px-3 text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 w-full rounded-lg border border-partner-line bg-partner-surface px-3 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={priorityLevel}
            onChange={(e) => setPriorityLevel(e.target.value)}
            className="h-10 w-full rounded-lg border border-partner-line bg-partner-surface px-3 text-sm"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Describe your issue in detail…"
            className="w-full rounded-lg border border-partner-line bg-transparent p-3 text-sm"
          />
          <input
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
            placeholder="Booking reference (optional, e.g. HOMEEIGO-20260613-00001)"
            className="h-10 w-full rounded-lg border border-partner-line bg-transparent px-3 text-sm"
          />
          <input
            value={attachments}
            onChange={(e) => setAttachments(e.target.value)}
            placeholder="Attachment URLs (comma-separated)"
            className="h-10 w-full rounded-lg border border-partner-line bg-transparent px-3 text-sm"
          />
        </div>
        {error ? <p className="mt-2 text-sm text-partner-error">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <PartnerButton variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </PartnerButton>
          <PartnerButton
            className="flex-1"
            disabled={create.isPending || subject.trim().length < 3 || description.trim().length < 10}
            onClick={submit}
          >
            {create.isPending ? "Creating…" : "Submit"}
          </PartnerButton>
        </div>
      </PartnerCard>
    </div>
  );
}
