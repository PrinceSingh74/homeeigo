"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Clock,
  Hourglass,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

/**
 * Human approval queue for high-risk AI actions.
 *
 * This is the surface the tool layer refuses to act without. Every high-risk capability —
 * refunds, payouts, ledger entries, account freezes — stops here and waits for a person.
 *
 * The screen is deliberately dense with the facts an approver needs to decide: what action,
 * against which target, with which parameters, requested by whom, and how long the
 * authorisation stays valid. Approving something you cannot see is a rubber stamp, so an
 * approval with no reviewable payload is called out rather than quietly rendered as empty.
 */

type Approval = {
  approvalId: string;
  toolId: string;
  requestedBy: string;
  requestedRole: string;
  argumentsHash: string;
  argumentsPreview?: Record<string, unknown> | null;
  resourceRef?: string | null;
  riskScore: number;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type ApprovalStats = {
  pending?: number;
  approved?: number;
  rejected?: number;
  expired?: number;
};

/** Splits a tool id into the parts an approver reads: domain, action. */
function describeTool(toolId: string): { domain: string; action: string } {
  const parts = toolId.split(".");
  return {
    domain: parts.slice(0, -1).join(" › ") || toolId,
    action: parts[parts.length - 1] ?? toolId,
  };
}

function riskTone(score: number): { label: string; className: string } {
  if (score >= 0.9) {
    return { label: "Critical", className: "text-[var(--color-biz-danger)] bg-[color-mix(in_srgb,var(--color-biz-danger)_14%,transparent)]" };
  }
  if (score >= 0.6) {
    return { label: "High", className: "text-[var(--color-biz-warning)] bg-[color-mix(in_srgb,var(--color-biz-warning)_14%,transparent)]" };
  }
  return { label: "Elevated", className: "text-[var(--color-biz-cyan)] bg-[var(--color-biz-cyan-dim)]" };
}

/** Remaining validity, or an explicit expired state — never a silently stale row. */
function expiryLabel(expiresAt: string): { text: string; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return { text: "unknown", expired: false };
  if (ms <= 0) return { text: "expired", expired: true };

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { text: `${minutes}m left`, expired: false };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { text: `${hours}h ${minutes % 60}m left`, expired: false };
  return { text: `${Math.floor(hours / 24)}d ${hours % 24}h left`, expired: false };
}

export default function AiApprovalsPage() {
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  const approvalsQuery = useQuery({
    queryKey: ["ai-tool-approvals"],
    queryFn: () => adminApi.aiTools.approvals({ limit: 50 }),
    // Approvals expire, so a stale queue is a misleading queue.
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const decide = useMutation({
    mutationFn: ({ approvalId, decision, reason }: { approvalId: string; decision: "APPROVED" | "REJECTED"; reason?: string }) =>
      adminApi.aiTools.decideApproval(approvalId, { decision, reason }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-tool-approvals"] });
      setActiveId(null);
    },
  });

  const data = approvalsQuery.data as { approvals?: Approval[]; stats?: ApprovalStats } | undefined;
  const approvals = useMemo(() => data?.approvals ?? [], [data]);
  const stats = data?.stats ?? {};

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">High-risk approvals</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          AI cannot execute these actions. Each one waits here for a person.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Awaiting decision" value={approvalsQuery.isLoading ? "—" : String(stats.pending ?? approvals.length)} icon={Hourglass} accent="amber" />
        <KpiCard label="Approved" value={approvalsQuery.isLoading ? "—" : String(stats.approved ?? 0)} icon={Check} accent="green" />
        <KpiCard label="Rejected" value={approvalsQuery.isLoading ? "—" : String(stats.rejected ?? 0)} icon={X} />
        <KpiCard label="Expired unused" value={approvalsQuery.isLoading ? "—" : String(stats.expired ?? 0)} icon={Clock} />
      </div>

      {approvalsQuery.isError && (
        <div className="biz-card border-[var(--color-biz-danger)] p-5 text-sm text-[var(--color-biz-danger)]">
          Could not load the approval queue. Nothing has been approved or rejected.
        </div>
      )}

      {!approvalsQuery.isLoading && approvals.length === 0 && (
        <div className="biz-card flex flex-col items-center gap-2 p-10 text-center">
          <ShieldAlert className="h-8 w-8 text-[var(--color-biz-muted)]" />
          <p className="font-medium">Nothing awaiting approval</p>
          <p className="text-sm text-[var(--color-biz-muted)]">
            High-risk AI actions appear here the moment one is requested.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {approvals.map((approval) => {
          const { domain, action } = describeTool(approval.toolId);
          const risk = riskTone(approval.riskScore);
          const expiry = expiryLabel(approval.expiresAt);
          const busy = decide.isPending && activeId === approval.approvalId;
          const preview = approval.argumentsPreview;
          const hasPreview = preview && Object.keys(preview).length > 0;

          return (
            <div key={approval.approvalId} className="biz-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--color-biz-danger)_12%,transparent)] text-[var(--color-biz-danger)]">
                      <AlertTriangle className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold">{action}</h2>
                      <p className="truncate text-xs text-[var(--color-biz-muted)]">{domain}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${risk.className}`}>
                    {risk.label} · {approval.riskScore.toFixed(2)}
                  </span>
                  <span
                    className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                      expiry.expired
                        ? "bg-[color-mix(in_srgb,var(--color-biz-danger)_14%,transparent)] text-[var(--color-biz-danger)]"
                        : "bg-[var(--color-biz-faint)] text-[var(--color-biz-muted)]"
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {expiry.text}
                  </span>
                </div>
              </div>

              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-biz-muted)]">Requested by</dt>
                  <dd className="mt-1 flex items-center gap-1.5 font-medium">
                    <User className="h-3.5 w-3.5 text-[var(--color-biz-muted)]" />
                    <span className="truncate">{approval.requestedBy}</span>
                    <span className="text-xs text-[var(--color-biz-muted)]">({approval.requestedRole})</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-biz-muted)]">Target</dt>
                  <dd className="mt-1 truncate font-medium">
                    {approval.resourceRef ?? <span className="text-[var(--color-biz-muted)]">not resource-bound</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-biz-muted)]">Tool</dt>
                  <dd className="mt-1 truncate font-mono text-xs">{approval.toolId}</dd>
                </div>
              </dl>

              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-[var(--color-biz-muted)]">Parameters</p>
                {hasPreview ? (
                  <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-[var(--color-biz-faint)] p-3 font-mono text-xs leading-relaxed">
                    {JSON.stringify(preview, null, 2)}
                  </pre>
                ) : (
                  // Approving an action whose parameters are unavailable is a rubber stamp.
                  // Say so rather than showing an empty box that reads as "nothing to see".
                  <p className="mt-1 rounded-lg bg-[color-mix(in_srgb,var(--color-biz-warning)_10%,transparent)] p-3 text-xs text-[var(--color-biz-warning)]">
                    No reviewable parameters were captured for this request. Reject it unless you can
                    verify the intent another way — approving blind is not a decision.
                  </p>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-biz-line)] pt-4 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={reasons[approval.approvalId] ?? ""}
                  onChange={(e) => setReasons((r) => ({ ...r, [approval.approvalId]: e.target.value }))}
                  placeholder="Reason (recorded in the audit trail)"
                  className="flex-1 rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || expiry.expired}
                    onClick={() => {
                      setActiveId(approval.approvalId);
                      decide.mutate({
                        approvalId: approval.approvalId,
                        decision: "REJECTED",
                        reason: reasons[approval.approvalId],
                      });
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--color-biz-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-biz-faint)] disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busy || expiry.expired || !hasPreview}
                    onClick={() => {
                      setActiveId(approval.approvalId);
                      decide.mutate({
                        approvalId: approval.approvalId,
                        decision: "APPROVED",
                        reason: reasons[approval.approvalId],
                      });
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-biz-bg)] hover:opacity-90 disabled:opacity-40"
                    title={!hasPreview ? "Cannot approve an action with no reviewable parameters" : undefined}
                  >
                    <Check className="h-4 w-4" />
                    {busy ? "Recording…" : "Approve"}
                  </button>
                </div>
              </div>

              {decide.isError && activeId === approval.approvalId && (
                <p className="mt-2 text-xs text-[var(--color-biz-danger)]">
                  The decision was not recorded. Nothing changed — try again.
                </p>
              )}

              <p className="mt-3 text-xs text-[var(--color-biz-muted)]">
                Approving authorises this exact action once. It cannot be reused for a different
                tool, target, parameters or requester, and it stops working when it expires.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
