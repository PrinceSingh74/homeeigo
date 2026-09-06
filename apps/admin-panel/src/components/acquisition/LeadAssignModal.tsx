"use client";

import { useEffect, useState } from "react";
import { GlassModal } from "@/components/acquisition/GlassModal";
import { useAdminUsers } from "@/hooks/use-partner-lead-crm";

type LeadAssignModalProps = {
  open: boolean;
  currentAssigneeId?: string | null;
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: (adminId: string) => void;
};

export function LeadAssignModal({
  open,
  currentAssigneeId,
  isLoading,
  onClose,
  onConfirm,
}: LeadAssignModalProps) {
  const admins = useAdminUsers();
  const [selected, setSelected] = useState(currentAssigneeId ?? "");

  useEffect(() => {
    if (open) setSelected(currentAssigneeId ?? "");
  }, [open, currentAssigneeId]);

  const options = admins.data ?? [];

  return (
    <GlassModal
      open={open}
      title="Assign lead"
      subtitle="Route this lead to an acquisition executive or team member."
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
            disabled={!selected || isLoading}
            onClick={() => onConfirm(selected)}
            className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isLoading ? "Assigning…" : "Assign lead"}
          </button>
        </>
      }
    >
      <div className="space-y-2">
        {admins.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-[var(--color-biz-elevated)]" />
            ))}
          </div>
        ) : options.length === 0 ? (
          <p className="text-sm text-[var(--color-biz-muted)]">No active admin users found.</p>
        ) : (
          options.map((admin) => {
            const name =
              [admin.user?.firstName, admin.user?.lastName].filter(Boolean).join(" ") ||
              admin.user?.email ||
              admin.id;
            const active = selected === admin.id;
            return (
              <button
                key={admin.id}
                type="button"
                onClick={() => setSelected(admin.id)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                  active
                    ? "border-[var(--color-biz-accent)] bg-[var(--color-biz-accent-dim)]"
                    : "border-[var(--color-biz-line)] hover:border-[var(--color-biz-line-strong)]"
                }`}
              >
                <div>
                  <p className="text-sm font-semibold">{name}</p>
                  {admin.user?.email ? (
                    <p className="text-xs text-[var(--color-biz-muted)]">{admin.user.email}</p>
                  ) : null}
                </div>
                {active ? (
                  <span className="text-xs font-semibold text-[var(--color-biz-accent)]">Selected</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </GlassModal>
  );
}
