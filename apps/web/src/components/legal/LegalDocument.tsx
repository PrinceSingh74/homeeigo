"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { LegalNav } from "@/components/legal/LegalNav";
import { type LegalDoc } from "@/lib/legal/legal-docs";
import { LEGAL_EFFECTIVE } from "@/lib/legal/legal-data";

export type LegalTocItem = { id: string; title: string };

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reading frame shared by all four legal documents: document header, document
 * switcher, generated table of contents with active-section tracking, and the
 * measured prose column.
 *
 * `children` stays server-rendered — the client boundary here only covers
 * scroll observation, so the policy markup itself ships no extra JavaScript.
 * The table of contents is derived from the same section list the caller
 * renders, so headings are never restated.
 */
export function LegalDocument({
  doc,
  toc,
  header,
  children,
  footer,
  surface = true,
}: {
  doc: LegalDoc;
  toc: readonly LegalTocItem[];
  /** Optional header extras (trust badges, reading meta, consent actions). */
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Wrap the clauses in a document surface. Interactive pages that already
   * card their own blocks (cookie preferences) turn this off so surfaces
   * don't nest.
   */
  surface?: boolean;
}) {
  const [activeId, setActiveId] = useState<string>(toc[0]?.id ?? "");
  const [showTop, setShowTop] = useState(false);
  const railRef = useRef<HTMLOListElement>(null);
  const hasToc = toc.length > 0;

  useEffect(() => {
    if (toc.length === 0) return;
    let raf = 0;

    const update = () => {
      const offset = 112;
      let current = toc[0]?.id ?? "";
      for (const item of toc) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= offset) current = item.id;
      }
      setActiveId(current);
      setShowTop(window.scrollY > 640);
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [toc]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !activeId) return;
    const item = rail.querySelector<HTMLElement>(`[data-toc-id="${activeId}"]`);
    if (!item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight) {
      rail.scrollTop = top - rail.clientHeight / 2 + item.offsetHeight / 2;
    }
  }, [activeId]);

  const tocLinks = (opts: { numbered?: boolean; rail?: boolean }) =>
    toc.map((item, i) => {
      const active = item.id === activeId;
      return (
        <li key={item.id} data-toc-id={item.id}>
          <a
            href={`#${item.id}`}
            aria-current={active ? "true" : undefined}
            className={cn(
              "outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-primary/60",
              opts.rail
                ? cn(
                    "-ml-px flex border-l-2 py-1.5 pl-3.5 pr-2 text-sm",
                    active
                      ? "border-legal-accent font-semibold text-legal-accent"
                      : "border-transparent text-muted hover:border-line hover:text-content",
                  )
                : cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-sm",
                    active
                      ? "bg-primary/10 font-semibold text-legal-accent"
                      : "text-muted hover:bg-canvas hover:text-content",
                  ),
            )}
          >
            {opts.numbered ? (
              <span className="w-5 shrink-0 font-mono text-xs tabular-nums text-muted/70">
                {String(i + 1).padStart(2, "0")}
              </span>
            ) : null}
            <span>{item.title}</span>
          </a>
        </li>
      );
    });

  return (
    <>
      <LegalNav current={doc.href} variant="pills" />

      <div className="mx-auto max-w-[90rem] px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-14">
        <div
          className={cn(
            "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-10",
            hasToc &&
              "xl:grid-cols-[13rem_minmax(0,42rem)_13rem] xl:justify-center xl:gap-12",
          )}
        >
          <aside className="hidden lg:block">
            <LegalNav current={doc.href} variant="rail" />
          </aside>

          <div id="legal-content" className="min-w-0">
            <header className="max-w-[42rem]">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-legal-accent">
                {doc.eyebrow}
              </p>
              <h1 className="mt-3 font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-[1.12] tracking-tight text-content">
                {doc.title}
              </h1>
              <span aria-hidden className="legal-title-rule mt-4 block" />
              <p className="mt-5 text-base leading-relaxed text-muted sm:text-[1.0625rem]">
                {doc.subtitle}
              </p>
              <p className="mt-4 text-sm font-medium text-muted">
                Effective <time dateTime={LEGAL_EFFECTIVE}>{LEGAL_EFFECTIVE}</time>
                {" · "}
                Last reviewed <time dateTime={LEGAL_EFFECTIVE}>{LEGAL_EFFECTIVE}</time>
              </p>
              {header ? <div className="mt-6">{header}</div> : null}
            </header>

            {hasToc ? (
              <details className="legal-toc-details group mt-8 rounded-xl border border-line bg-surface/60 print:hidden xl:hidden">
                <summary className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-content outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
                  <span>On this page</span>
                  <span className="ml-auto text-xs font-medium tabular-nums text-muted">
                    {toc.length} sections
                  </span>
                  <ChevronDown
                    size={16}
                    aria-hidden
                    className="shrink-0 text-muted transition-transform group-open:rotate-180"
                  />
                </summary>
                <ol className="border-t border-line px-2 py-2">{tocLinks({ numbered: true })}</ol>
              </details>
            ) : null}

            <div
              className={cn(
                "mt-8 sm:mt-10",
                surface &&
                  "rounded-2xl border border-line bg-surface px-5 py-7 shadow-e1 sm:px-8 sm:py-10 lg:px-10 lg:py-12",
              )}
            >
              <div className="legal-sections mx-auto max-w-[42rem]">{children}</div>
            </div>
          </div>

          {hasToc ? (
            <aside className="hidden print:hidden xl:block">
              <div className="sticky top-[4.75rem]">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  On this page
                </p>
                <nav aria-label="On this page" className="mt-3">
                  <ol
                    ref={railRef}
                    className="scrollbar-none max-h-[calc(100vh-11rem)] overflow-y-auto border-l border-line"
                  >
                    {tocLinks({ rail: true })}
                  </ol>
                </nav>
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      {footer}

      {showTop ? (
        <button
          type="button"
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: prefersReducedMotion() ? "auto" : "smooth",
            })
          }
          aria-label="Back to top"
          className="legal-to-top fixed bottom-6 right-4 z-30 grid size-11 place-items-center rounded-full border border-line bg-surface text-content shadow-e3 outline-none transition-colors hover:border-primary/40 hover:text-legal-accent focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas print:hidden sm:right-6"
        >
          <ArrowUp size={18} aria-hidden />
        </button>
      ) : null}
    </>
  );
}
