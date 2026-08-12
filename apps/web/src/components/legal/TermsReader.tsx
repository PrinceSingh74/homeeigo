"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Printer, Clock, List, X, ArrowUp } from "lucide-react";
import { LegalHero } from "@/components/legal/LegalHero";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { TERMS_SECTIONS } from "@/lib/legal/legal-data";
import { cn } from "@/lib/utils";

const WPM = 200;

export function TermsReader() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(TERMS_SECTIONS[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  const readingTime = useMemo(() => {
    const words = TERMS_SECTIONS.reduce(
      (n, s) => n + s.title.split(/\s+/).length + s.body.split(/\s+/).length,
      0,
    );
    return Math.max(1, Math.round(words / WPM));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return TERMS_SECTIONS;
    return TERMS_SECTIONS.filter(
      (s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
    );
  }, [q]);

  // Scroll progress + back-to-top visibility (rAF-throttled).
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.documentElement;
        const max = el.scrollHeight - el.clientHeight;
        setProgress(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0);
        setShowTop(el.scrollTop > 600);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Active section tracking.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );
    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [filtered]);

  const scrollTo = (id: string) => {
    setTocOpen(false);
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="min-h-screen">
      {/* Scroll progress bar */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-[130] h-1 bg-transparent print:hidden"
      >
        <div
          className="h-full bg-aurora transition-[width] duration-150 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <LegalHero
        eyebrow="Legal Agreement"
        title="Terms of Service"
        subtitle="The rules and responsibilities that govern use of the HOMEEIGO platform."
      >
        {/* Meta toolbar */}
        <div className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-2.5 print:hidden">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line/60 bg-surface/70 px-3.5 py-2 text-sm font-medium text-content shadow-e1 backdrop-blur-md">
            <Clock size={15} className="text-primary" aria-hidden />
            {readingTime} min read
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line/60 bg-surface/70 px-3.5 py-2 text-sm font-medium text-content shadow-e1 backdrop-blur-md">
            <List size={15} className="text-primary" aria-hidden />
            {TERMS_SECTIONS.length} sections
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line/60 bg-surface/70 px-3.5 py-2 text-sm font-medium text-content shadow-e1 backdrop-blur-md transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Printer size={15} aria-hidden />
            Print
          </button>
        </div>
      </LegalHero>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Mobile TOC toggle */}
        <button
          type="button"
          onClick={() => setTocOpen((v) => !v)}
          className="mb-4 flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-content shadow-e1 lg:hidden print:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <List size={16} aria-hidden /> Table of Contents
          </span>
          {tocOpen ? <X size={16} aria-hidden /> : null}
        </button>

        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-10">
          {/* Sticky Table of Contents */}
          <aside
            className={cn(
              "lg:sticky lg:top-24 lg:h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto print:hidden",
              tocOpen ? "block" : "hidden lg:block",
            )}
          >
            {/* Search within document */}
            <div className="relative mb-4">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search terms…"
                aria-label="Search within Terms of Service"
                className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-content shadow-e1 outline-none transition-colors placeholder:text-muted focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>

            <nav aria-label="Table of contents">
              <ol className="space-y-0.5">
                {filtered.map((s) => {
                  const active = s.id === activeId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => scrollTo(s.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-primary/10 font-semibold text-primary"
                            : "text-muted hover:bg-canvas/60 hover:text-content",
                        )}
                      >
                        <span className={cn("text-xs tabular-nums", active ? "text-primary" : "text-muted/70")}>
                          {String(TERMS_SECTIONS.indexOf(s) + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 ? (
                  <li className="px-3 py-4 text-sm text-muted">No sections match “{query}”.</li>
                ) : null}
              </ol>
            </nav>
          </aside>

          {/* Content */}
          <div>
            {q ? (
              <p className="mb-6 text-sm text-muted print:hidden">
                Showing {filtered.length} of {TERMS_SECTIONS.length} sections for “{query}”.
              </p>
            ) : null}
            <div className="space-y-5">
              {filtered.map((s) => (
                <section
                  key={s.id}
                  id={s.id}
                  ref={(el) => {
                    if (el) sectionRefs.current.set(s.id, el);
                    else sectionRefs.current.delete(s.id);
                  }}
                  className="scroll-mt-24 rounded-3xl border border-line bg-surface/80 p-6 shadow-e1 backdrop-blur-sm sm:p-8"
                >
                  <h2 className="flex items-baseline gap-3 font-display text-xl font-bold text-content sm:text-2xl">
                    <span aria-hidden className="font-mono text-sm font-semibold text-primary">
                      {String(TERMS_SECTIONS.indexOf(s) + 1).padStart(2, "0")}
                    </span>
                    {s.title}
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">{s.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Back to top */}
      {showTop ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
          className="fixed bottom-24 right-4 z-[120] grid size-11 place-items-center rounded-full bg-primary text-white shadow-e4 transition-transform hover:scale-105 lg:bottom-8 print:hidden"
        >
          <ArrowUp size={18} aria-hidden />
        </button>
      ) : null}

      <LegalFooterNav current="/legal/terms" />
    </main>
  );
}
