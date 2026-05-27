"use client";

import { WALLET_BREAKDOWN, WALLET_TOTAL_BALANCE } from "@/lib/wallet-dashboard";

const R = 72;
const C = 2 * Math.PI * R;

export function WalletDonutChart() {
  let offset = 0;

  return (
    <div className="flex w-full min-w-0 flex-col items-center">
      <div className="relative size-[min(100%,180px)] max-w-[200px] sm:size-[200px]">
        <svg viewBox="0 0 200 200" className="size-full -rotate-90">
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            className="stroke-line"
            strokeWidth="12"
          />
          {WALLET_BREAKDOWN.map((seg, i) => {
            const dash = (seg.pct / 100) * C;
            const el = (
              <circle
                key={seg.label}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth="12"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
                style={{ transitionDelay: `${i * 120}ms` }}
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
          <span className="text-[10px] text-muted sm:text-xs">Total</span>
          <span className="font-display text-lg font-bold text-content sm:text-xl">
            ₹{WALLET_TOTAL_BALANCE.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      <ul className="mt-4 w-full min-w-0 space-y-2.5 sm:mt-6 sm:space-y-3">
        {WALLET_BREAKDOWN.map((seg) => (
          <li
            key={seg.label}
            className="flex min-w-0 items-center justify-between gap-2 text-[12px] sm:text-sm"
          >
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span
                className="size-2.5 shrink-0 rounded-full sm:size-3"
                style={{ backgroundColor: seg.color }}
              />
              <span className="truncate">{seg.label}</span>
            </span>
            <span className="shrink-0 font-semibold text-content">
              ₹{seg.value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
