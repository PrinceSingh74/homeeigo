"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Mic } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { searchServices } from "@/lib/services";
import { bookUrl } from "@/lib/booking-url";
import { useAppStore } from "@/stores/app-store";
import { Input } from "@/components/ui/Input";
import { ServiceImage } from "@/components/ui/ServiceImage";

type ServiceSearchInputProps = {
  className?: string;
  inputClassName?: string;
  initialQuery?: string;
  onNavigate?: () => void;
  /** Sync query to parent (e.g. filter services on /book) */
  onQueryChange?: (query: string) => void;
  /** Stay on /book: select service without full navigation */
  onSelectService?: (serviceId: string, query: string) => void;
  /** Figma spec hero search on /services */
  variant?: "default" | "hero";
};

export function ServiceSearchInput({
  className,
  inputClassName,
  initialQuery = "",
  onNavigate,
  onQueryChange,
  onSelectService,
  variant = "default",
}: ServiceSearchInputProps) {
  const isHero = variant === "hero";
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const router = useRouter();
  const showToast = useAppStore((s) => s.showToast);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = searchServices(query).slice(0, 6);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function goToService(serviceId: string) {
    const q = query.trim();
    setOpen(false);
    onNavigate?.();
    if (onSelectService) {
      onSelectService(serviceId, q);
      return;
    }
    router.push(bookUrl({ service: serviceId, q: q || undefined }));
  }

  function submitSearch() {
    const q = query.trim();
    if (!q) {
      showToast("Type a service to search", "info");
      return;
    }
    onQueryChange?.(q);
    const match = searchServices(q)[0];
    if (match) {
      goToService(match.id);
      return;
    }
    setOpen(false);
    onNavigate?.();
    if (onSelectService) {
      router.replace(bookUrl({ q }), { scroll: false });
      return;
    }
    router.push(bookUrl({ q }));
  }

  const micButton = (
    <motion.button
      type="button"
      onClick={() => {
        setListening((v) => !v);
        if (!listening) {
          showToast("Voice search — say a service name (demo)", "info");
          setTimeout(() => {
            const demo = "home cleaning";
            setQuery(demo);
            onQueryChange?.(demo);
            setListening(false);
            setOpen(true);
          }, 1200);
        }
      }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.92 }}
      aria-label={listening ? "Stop voice search" : "Search by voice"}
      aria-pressed={listening}
      className={cn(
        "grid shrink-0 place-items-center rounded-full transition-colors",
        isHero ? "size-8 text-muted hover:text-primary" : "size-9",
        !isHero &&
          (listening
            ? "bg-pink/15 text-pink animate-pulse-glow"
            : "text-muted hover:text-primary"),
        isHero && listening && "text-primary",
      )}
    >
      <Mic size={isHero ? 16 : 20} />
    </motion.button>
  );

  return (
    <div
      ref={wrapRef}
      className={cn("relative flex min-w-0 flex-1 items-stretch gap-2", className)}
    >
      <Input
        type="search"
        variant="search"
        size={isHero ? "xl" : "lg"}
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          onQueryChange?.(next);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submitSearch();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={
          isHero
            ? "Search cleaning, AC repair, plumbing..."
            : "Search for a service…"
        }
        aria-label="Search for a service"
        aria-expanded={open && results.length > 0}
        aria-autocomplete="list"
        iconRight={micButton}
        showClear={false}
        className="min-w-0 flex-1"
        containerClassName={cn(
          isHero
            ? [
                "h-14 rounded-[18px] border-line shadow-[0_8px_24px_rgb(0_0_0/0.08)]",
                "focus-within:border-primary focus-within:shadow-[0_8px_32px_rgb(37_99_235/0.15)]",
              ]
            : [
                "h-16 rounded-2xl glass-card border-line/50 shadow-e2",
                "focus-within:shadow-[0_0_0_4px_rgb(37_99_235/0.14),0_16px_40px_-12px_rgb(15_23_42/0.25)]",
              ],
          inputClassName,
        )}
        inputClassName={cn(
          isHero
            ? "text-[15px] placeholder:text-muted"
            : "text-base placeholder:italic",
        )}
      />

      {isHero ? (
        <motion.button
          type="button"
          onClick={submitSearch}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          aria-label="Search"
          className="grid size-14 shrink-0 place-items-center self-center rounded-xl bg-gradient-to-br from-primary to-violet text-white shadow-[0_4px_12px_rgb(37_99_235/0.3)]"
        >
          <Search size={20} aria-hidden />
        </motion.button>
      ) : null}

      <AnimatePresence>
        {open && query.trim() && results.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-[60] overflow-hidden rounded-2xl border border-line bg-surface shadow-e5"
          >
            {results.map((s, index) => (
              <li key={s.id} role="option" aria-selected={index === 0}>
                <button
                  type="button"
                  onClick={() => goToService(s.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-primary/5"
                >
                  {s.img ? (
                    <ServiceImage
                      src={s.img}
                      alt=""
                      size={40}
                      sizes="40px"
                      className="size-10"
                    />
                  ) : null}
                  <span className="flex-1">
                    <span className="block font-bold text-content">
                      {s.title}
                    </span>
                    <span className="text-xs text-muted">
                      From {s.price}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={submitSearch}
                className="w-full border-t border-line px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/5"
              >
                Search all results for &ldquo;{query}&rdquo;
              </button>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
