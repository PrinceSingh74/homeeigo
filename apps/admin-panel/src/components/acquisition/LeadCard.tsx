"use client";

import { MessageSquare, Phone, UserPlus, ChevronRight } from "lucide-react";
import { LeadStatusChip } from "@/components/acquisition/LeadStatusChip";
import { cn } from "@/lib/cn";
import { followUpTone, formatFollowUp, relTime } from "@/lib/lead-crm-utils";
import type { PartnerLead } from "@/services/admin-api";

type LeadCardProps = {
  lead: PartnerLead;
  selected?: boolean;
  onSelect: () => void;
  onAssign: () => void;
  onCall: () => void;
  onMessage: () => void;
};

export function LeadCard({ lead, selected, onSelect, onAssign, onCall, onMessage }: LeadCardProps) {
  const followTone = followUpTone(lead.nextFollowUpAt);

  return (
    <article
      className={cn(
        "group border-b border-[var(--color-biz-line)] px-4 py-4 transition-all duration-200",
        selected
          ? "bg-[var(--color-biz-accent-dim)] ring-1 ring-inset ring-[var(--color-biz-accent)]/30"
          : "hover:bg-[var(--color-biz-elevated)]/60",
      )}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold tracking-tight">{lead.name}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--color-biz-muted)]">
              {lead.skillInterest ?? "General"}
              {lead.zone || lead.city ? ` · ${[lead.zone, lead.city].filter(Boolean).join(", ")}` : ""}
            </p>
          </div>
          <LeadStatusChip status={lead.status} />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="rounded-md bg-[var(--color-biz-elevated)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
            {lead.source.replace(/_/g, " ")}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-biz-faint)]">Score</span>
            <span className="font-num text-sm font-bold tabular-nums text-[var(--color-biz-accent)]">{lead.leadScore}</span>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <p className="text-[var(--color-biz-faint)]">Last activity</p>
            <p className="font-medium text-[var(--color-biz-muted)]">{relTime(lead.lastActivityAt)}</p>
          </div>
          <div>
            <p className="text-[var(--color-biz-faint)]">Next follow-up</p>
            <p
              className={cn(
                "font-medium",
                followTone === "overdue" && "text-[var(--color-biz-danger)]",
                followTone === "today" && "text-[var(--color-biz-warning)]",
                followTone === "upcoming" && "text-[var(--color-biz-cyan)]",
                followTone === "none" && "text-[var(--color-biz-muted)]",
              )}
            >
              {formatFollowUp(lead.nextFollowUpAt)}
            </p>
          </div>
        </div>
      </button>

      <div className="mt-3 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <ActionBtn icon={Phone} label="Call" onClick={onCall} />
        <ActionBtn icon={MessageSquare} label="Message" onClick={onMessage} />
        <ActionBtn icon={UserPlus} label="Assign" onClick={onAssign} />
        <button
          type="button"
          onClick={onSelect}
          className="ml-auto inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--color-biz-accent)] hover:bg-[var(--color-biz-accent-dim)]"
        >
          Open
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Phone;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] text-[var(--color-biz-muted)] transition hover:border-[var(--color-biz-line-strong)] hover:text-[var(--color-biz-text)]"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
