"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { LEGAL_DOCS, LEGAL_HOME } from "@/lib/legal/legal-docs";

/**
 * Persistent chrome for the Legal Center: a slim breadcrumb bar and a
 * reading-progress hairline.
 *
 * Legal routes sit outside the authenticated app shell so they stay publicly
 * reachable. The breadcrumb restores a route back to the product without
 * touching the global Navbar.
 */
export function LegalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.documentElement;
        const max = el.scrollHeight - el.clientHeight;
        setProgress(max > 8 ? Math.min(100, (el.scrollTop / max) * 100) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [pathname]);

  const onHome = pathname === LEGAL_HOME;
  const currentDoc = LEGAL_DOCS.find((doc) => doc.href === pathname);

  return (
    // Same page canvas as the Services page root: white in light, app canvas in dark.
    <div className="legal-page min-h-screen bg-white dark:bg-canvas">
      <a
        href="#legal-content"
        className="sr-only rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-content shadow-e3 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60]"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-white/80 backdrop-blur-md print:hidden dark:bg-canvas/85">
        <div className="mx-auto flex h-14 max-w-[90rem] items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex shrink-0 items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            aria-label="HOMEEIGO home"
          >
            <Image
              src="/brand/logo-full.png"
              alt=""
              width={560}
              height={386}
              className="h-8 w-[46px] object-contain dark:hidden"
            />
            <Image
              src="/brand/logo-full-dark.png"
              alt=""
              width={560}
              height={386}
              className="hidden h-8 w-[46px] object-contain dark:block"
            />
            <span className="sr-only">HOMEEIGO</span>
          </Link>

          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
            <ChevronRight size={14} className="shrink-0 text-muted/70" aria-hidden />
            {onHome ? (
              <span aria-current="page" className="truncate text-sm font-semibold text-content">
                Legal
              </span>
            ) : (
              <Link
                href={LEGAL_HOME}
                className="shrink-0 rounded-md text-sm font-semibold text-muted outline-none transition-colors hover:text-legal-accent focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                Legal
              </Link>
            )}
            {currentDoc ? (
              <>
                <ChevronRight size={14} className="shrink-0 text-muted/70" aria-hidden />
                <span aria-current="page" className="truncate text-sm font-semibold text-content">
                  {currentDoc.label}
                </span>
              </>
            ) : null}
          </nav>
        </div>

        <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          <div
            className="legal-progress h-full bg-gradient-to-r from-emerald-500 to-teal-500"
            style={{ transform: `scaleX(${progress / 100})` }}
          />
        </div>
      </header>

      {children}
    </div>
  );
}
