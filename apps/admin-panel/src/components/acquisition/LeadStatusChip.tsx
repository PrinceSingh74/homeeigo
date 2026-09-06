"use client";

import { cn } from "@/lib/cn";
import type { PartnerLeadStatus } from "@/services/admin-api";

const STATUS_STYLES: Record<PartnerLeadStatus, string> = {
  NEW: "bg-blue-50 text-blue-700 ring-blue-200/60",
  CONTACTED: "bg-slate-50 text-slate-700 ring-slate-200/60",
  INTERESTED: "bg-indigo-50 text-indigo-700 ring-indigo-200/60",
  APPLICATION_STARTED: "bg-violet-50 text-violet-700 ring-violet-200/60",
  APPLICATION_SUBMITTED: "bg-violet-50 text-violet-800 ring-violet-200/60",
  KYC_PENDING: "bg-amber-50 text-amber-800 ring-amber-200/60",
  VERIFICATION: "bg-sky-50 text-sky-800 ring-sky-200/60",
  TRAINING: "bg-purple-50 text-purple-800 ring-purple-200/60",
  APPROVED: "bg-emerald-50 text-emerald-800 ring-emerald-200/60",
  ACTIVATED: "bg-green-50 text-green-900 ring-green-200/70",
  DORMANT: "bg-neutral-100 text-neutral-600 ring-neutral-200/60",
  REJECTED: "bg-red-50 text-red-700 ring-red-200/60",
  DUPLICATE: "bg-orange-50 text-orange-700 ring-orange-200/60",
  INVALID: "bg-neutral-100 text-neutral-500 ring-neutral-200/60",
  WITHDRAWN: "bg-neutral-100 text-neutral-600 ring-neutral-200/60",
};

export function LeadStatusChip({ status, className }: { status: PartnerLeadStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        STATUS_STYLES[status],
        className,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
