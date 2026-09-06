"use client";

import { useEffect, useState } from "react";
import { GlassModal } from "@/components/acquisition/GlassModal";
import { LeadStatusChip } from "@/components/acquisition/LeadStatusChip";
import { usePartnerLeadTransitions } from "@/hooks/use-partner-lead-crm";
import type { PartnerLeadStatus } from "@/services/admin-api";

const TERMINAL: PartnerLeadStatus[] = ["REJECTED", "DUPLICATE", "INVALID", "WITHDRAWN"];

type LeadStatusModalProps = {
  open: boolean;
  leadId: string;
  currentStatus: PartnerLeadStatus;
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: (status: PartnerLeadStatus, reason?: string) => void;
};

export function LeadStatusModal({
  open,
  leadId,
  currentStatus,
  isLoading,
  onClose,
  onConfirm,
}: LeadStatusModalProps) {
  const transitions = usePartnerLeadTransitions(open ? leadId : undefined);
  const [next, setNext] = useState<PartnerLeadStatus | "">("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setNext("");
      setReason("");
    }
  }, [open, currentStatus]);

  const allowed = transitions.data?.allowed ?? [];
  const needsReason = next && (TERMINAL.includes(next) || next === "DORMANT");

  return (
    <GlassModal
      open={open}
      title="Change status"
      subtitle="Only valid pipeline transitions are allowed."
      onClose={onClose}
      isLoading={isLoading}
      footer={
        <>
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!next || Boolean(isLoading) || Boolean(needsReason && !reason.trim())}
            onClick={() => next && onConfirm(next, reason.trim() || undefined)}
            className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isLoading ? "Updating…" : "Update status"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-biz-muted)]">Current</span>
          <LeadStatusChip status={currentStatus} />
        </div>

        {transitions.isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-[var(--color-biz-elevated)]" />
            ))}
          </div>
        ) : allowed.length === 0 ? (
          <p className="text-sm text-[var(--color-biz-muted)]">This lead is in a terminal state.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {allowed.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setNext(status)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  next === status
                    ? "border-[var(--color-biz-accent)] bg-[var(--color-biz-accent-dim)]"
                    : "border-[var(--color-biz-line)] hover:border-[var(--color-biz-line-strong)]"
                }`}
              >
                <LeadStatusChip status={status} />
              </button>
            ))}
          </div>
        )}

        {needsReason ? (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
              Reason required
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Explain why this status change is being made…"
              className="w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-3 py-2.5 text-sm outline-none ring-[var(--color-biz-accent)] focus:ring-2"
            />
          </div>
        ) : null}
      </div>
    </GlassModal>
  );
}
