"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Wrench, CalendarCheck, Users, Loader2, CornerDownLeft } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type Item = { kind: "vendor" | "booking" | "customer"; id: string; title: string; sub: string; href: string };

/**
 * Global command-search across vendors, bookings and customers. Queries all
 * three admin list endpoints in parallel as you type (debounced), groups the
 * results in a dropdown, and navigates to the right detail on click / Enter.
 * ⌘K focuses; ↑/↓ navigate; Esc closes.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const q = useDebouncedValue(value.trim(), 220);
  const enabled = q.length >= 2;

  // ⌘K / Ctrl+K focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const vendors = useQuery({
    queryKey: ["gsearch", "vendors", q],
    queryFn: () => adminApi.listProviders({ search: q, limit: 5, status: "all" }),
    enabled,
    staleTime: 30_000,
  });
  const bookings = useQuery({
    queryKey: ["gsearch", "bookings", q],
    queryFn: () => adminApi.listBookings({ search: q, limit: 5 }),
    enabled,
    staleTime: 30_000,
  });
  const customers = useQuery({
    queryKey: ["gsearch", "customers", q],
    queryFn: () => adminApi.listUsers({ search: q, limit: 5 }),
    enabled,
    staleTime: 30_000,
  });

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const p of vendors.data?.providers ?? [])
      out.push({ kind: "vendor", id: p.id, title: p.name, sub: `${p.email ?? "partner"} · ★${(p.rating ?? 0).toFixed(1)}`, href: `/vendors/${p.id}` });
    for (const b of bookings.data?.bookings ?? [])
      out.push({ kind: "booking", id: b.id, title: b.bookingNumber ?? b.id.slice(0, 8), sub: `${b.service} · ${b.user} · ${b.status}`, href: `/bookings/${b.id}` });
    for (const c of customers.data?.users ?? [])
      out.push({ kind: "customer", id: c.id, title: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email, sub: `${c.email} · ${c.totalBookings} bookings`, href: `/customers?q=${encodeURIComponent(c.email)}` });
    return out;
  }, [vendors.data, bookings.data, customers.data]);

  const loading = enabled && (vendors.isFetching || bookings.isFetching || customers.isFetching);

  useEffect(() => setActive(0), [q]);

  function go(item: Item) {
    setOpen(false);
    setValue("");
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) go(items[active]);
      else if (value.trim()) { setOpen(false); router.push(`/bookings?q=${encodeURIComponent(value.trim())}`); }
    }
  }

  const groups: { label: string; icon: typeof Wrench; kind: Item["kind"] }[] = [
    { label: "Partners", icon: Wrench, kind: "vendor" },
    { label: "Bookings", icon: CalendarCheck, kind: "booking" },
    { label: "Customers", icon: Users, kind: "customer" },
  ];

  return (
    <div ref={boxRef} className="relative max-w-md flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-biz-faint)]" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search partners, bookings, customers…"
        className="w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)]/70 py-2 pl-9 pr-14 text-sm shadow-[inset_0_1px_2px_rgb(2_4_10_/_0.4)] outline-none transition-colors placeholder:text-[var(--color-biz-faint)] focus:border-[rgb(61_126_255_/_0.5)] focus:shadow-[inset_0_1px_2px_rgb(2_4_10_/_0.4),0_0_0_3px_rgb(61_126_255_/_0.12)]"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-biz-faint)] md:block">
        ⌘K
      </kbd>

      {open && enabled ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-2 shadow-2xl ring-1 ring-black/20">
          {loading && items.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-[var(--color-biz-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-[var(--color-biz-muted)]">
              No matches for “{q}”. Try a name, booking number, or email.
            </div>
          ) : (
            groups.map((g) => {
              const rows = items.filter((i) => i.kind === g.kind);
              if (!rows.length) return null;
              return (
                <div key={g.kind} className="mb-1">
                  <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-biz-faint)]">
                    <g.icon className="h-3 w-3" /> {g.label}
                  </p>
                  {rows.map((item) => {
                    const idx = items.indexOf(item);
                    return (
                      <button
                        key={`${item.kind}-${item.id}`}
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(item)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${
                          idx === active ? "bg-[var(--color-biz-accent-dim)]" : "hover:bg-[var(--color-biz-elevated)]"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--color-biz-text)]">{item.title}</p>
                          <p className="truncate text-[11px] text-[var(--color-biz-muted)]">{item.sub}</p>
                        </div>
                        {idx === active ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[var(--color-biz-accent)]" /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
