"use client";

import {
  ArrowRightLeft,
  CalendarClock,
  MessageSquare,
  Phone,
  PlayCircle,
  UserPlus,
} from "lucide-react";
import { LeadTimeline } from "@/components/acquisition/LeadTimeline";
import { formatFollowUp, followUpTone } from "@/lib/lead-crm-utils";
import { cn } from "@/lib/cn";
import type { PartnerLeadDetail } from "@/services/admin-api";

type LeadActionsPanelProps = {
  lead: PartnerLeadDetail;
  assigneeName?: string;
  onAssign: () => void;
  onStatus: () => void;
  onFollowUp: () => void;
  onCall: () => void;
  onMessage: () => void;
  onStartApplication?: () => void;
  className?: string;
};

export function LeadActionsPanel({
  lead,
  assigneeName,
  onAssign,
  onStatus,
  onFollowUp,
  onCall,
  onMessage,
  onStartApplication,
  className,
}: LeadActionsPanelProps) {
  const followTone = followUpTone(lead.nextFollowUpAt);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">Quick actions</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ActionButton icon={Phone} label="Call" onClick={onCall} />
        <ActionButton icon={MessageSquare} label="Message" onClick={onMessage} />
        <ActionButton icon={UserPlus} label="Assign" onClick={onAssign} />
        <ActionButton icon={ArrowRightLeft} label="Status" onClick={onStatus} />
        <ActionButton icon={CalendarClock} label="Follow-up" onClick={onFollowUp} className="col-span-2" primary={Boolean(lead.provider)} />
        {!lead.provider && onStartApplication ? (
          <ActionButton icon={PlayCircle} label="Start application" onClick={onStartApplication} className="col-span-2" primary />
        ) : null}
      </div>

      <div className="mt-5 rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/30 p-3">
        <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-faint)]">Assignment</p>
        <p className="mt-1 text-sm font-semibold">{assigneeName ?? "Unassigned"}</p>
        <p className="mt-3 text-[11px] uppercase tracking-wide text-[var(--color-biz-faint)]">Next follow-up</p>
        <p
          className={cn(
            "mt-1 text-sm font-semibold",
            followTone === "overdue" && "text-[var(--color-biz-danger)]",
            followTone === "today" && "text-[var(--color-biz-warning)]",
            followTone === "upcoming" && "text-[var(--color-biz-cyan)]",
          )}
        >
          {formatFollowUp(lead.nextFollowUpAt)}
        </p>
        {lead.followUpReason ? (
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{lead.followUpReason}</p>
        ) : null}
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
          Recent activity
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LeadTimeline activities={lead.activities} limit={8} />
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  className,
  primary,
}: {
  icon: typeof Phone;
  label: string;
  onClick: () => void;
  className?: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition duration-200",
        primary
          ? "col-span-2 border-[var(--color-biz-accent)] bg-[var(--color-biz-accent)] text-black hover:brightness-110"
          : "border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] text-[var(--color-biz-text)] hover:border-[var(--color-biz-line-strong)]",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
