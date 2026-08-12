"use client";

import { Modal } from "@/components/ui/Modal";
import { Trophy } from "lucide-react";
import {
  useReferralHistory,
  useReferralLeaderboard,
  useReferralSummary,
} from "@/hooks/use-referrals";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function ReferralDashboardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: summary } = useReferralSummary();
  const { data: history } = useReferralHistory(open);
  const { data: leaderboard } = useReferralLeaderboard(open);

  return (
    <Modal open={open} onClose={onClose} title="Referrals" size="md">
      <div className="flex flex-col gap-5">
        {/* Stat strip */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Friends", value: String(summary?.referralCount ?? 0) },
            { label: "Qualified", value: String(summary?.qualified ?? 0) },
            { label: "Earned", value: inr(summary?.totalEarned ?? 0) },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-line p-3 text-center">
              <p className="font-display text-lg font-bold text-content">{s.value}</p>
              <p className="text-[11px] text-muted">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Commission breakdown */}
        <div className="rounded-xl bg-canvas p-3 dark:bg-charcoal/60">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Pending (not yet booked)</span>
            <span className="font-medium text-content">{summary?.pending ?? 0} · {inr((summary?.pending ?? 0) * (summary?.commissionPerReferral ?? 100))}</span>
          </div>
          <div className="mt-1.5 flex justify-between text-sm">
            <span className="text-muted">Available to withdraw</span>
            <span className="font-bold text-success">{inr(summary?.balance ?? 0)}</span>
          </div>
        </div>

        {/* History */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">Referral history</p>
          {!history || history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line py-5 text-center text-xs text-muted">
              No referrals yet. Share your code to start earning.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between rounded-xl border border-line p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-content">{h.refereeName}</p>
                    <p className="text-[11px] text-muted">Joined {fmt(h.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase",
                        h.status === "QUALIFIED" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                      )}
                    >
                      {h.status === "QUALIFIED" ? `+${inr(h.amount)}` : "Pending"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Leaderboard */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted">
            <Trophy size={13} className="text-gold" /> Top referrers
          </p>
          {!leaderboard || leaderboard.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line py-4 text-center text-xs text-muted">
              Be the first on the leaderboard.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {leaderboard.map((l) => (
                <li key={l.rank} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-600/10 text-[11px] font-bold text-emerald-600">
                    {l.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-content">{l.name}</span>
                  <span className="text-xs text-muted">{l.referrals} ref</span>
                  <span className="text-sm font-bold text-content">{inr(l.earned)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
