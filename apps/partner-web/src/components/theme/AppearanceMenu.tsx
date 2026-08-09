"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Moon, Palette, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePartnerTheme } from "@/components/theme/ThemeProvider";

const OPTIONS = [
  { id: "light" as const, label: "Day mode", icon: Sun, hint: "Cream–sage gradient" },
  { id: "dark" as const, label: "Dark mode", icon: Moon, hint: "Night shift friendly" },
];

export function AppearanceMenu() {
  const { theme, setTheme } = usePartnerTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm font-medium transition",
          open
            ? "border-partner-primary/40 bg-partner-primary/10 text-partner-text"
            : "border-partner-line/80 bg-white/40 text-partner-text-secondary hover:border-partner-primary/30 hover:bg-partner-primary/5 dark:bg-white/5",
        )}
      >
        <Palette className="h-4 w-4 shrink-0 text-partner-primary" />
        <span className="hidden sm:inline">Appearance</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-partner-muted transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          role="menu"
          className="partner-glass absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-xl border border-partner-line shadow-xl"
        >
          <div className="border-b border-partner-line/80 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-partner-muted">Appearance</p>
          </div>
          <div className="p-1.5">
            {OPTIONS.map(({ id, label, icon: Icon, hint }) => {
              const active = theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setTheme(id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition",
                    active
                      ? "bg-partner-primary/12 text-partner-text"
                      : "text-partner-text-secondary hover:bg-partner-primary/8",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-partner-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-[11px] text-partner-muted">{hint}</p>
                  </div>
                  {active ? <Check className="h-4 w-4 shrink-0 text-partner-primary" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
