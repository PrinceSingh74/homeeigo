"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary for the HQ console. A crash in any (console) route
 * renders this graceful recover panel INSIDE the shell (sidebar intact) instead
 * of a white screen — enterprise-grade fault isolation.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunk = /ChunkLoadError|Loading chunk|dynamically imported module/i.test(
    `${error?.name} ${error?.message}`,
  );

  useEffect(() => {
    console.error("[HOMEEIGO HQ]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="biz-card p-8">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-biz-danger)]/12 ring-1 ring-[var(--color-biz-danger)]/25">
          <span className="text-2xl" aria-hidden>⚠️</span>
        </div>
        <p className="mt-5 text-lg font-bold text-[var(--color-biz-text)]">
          This screen hit an error
        </p>
        <p className="mt-2 text-sm text-[var(--color-biz-muted)]">
          {isChunk
            ? "A newer version of the console is available. Reload to continue."
            : "An unexpected error occurred rendering this view. You can retry — the rest of the console is unaffected."}
        </p>
        {error?.digest ? (
          <p className="mt-3 font-mono text-[11px] text-[var(--color-biz-faint)]">
            ref: {error.digest}
          </p>
        ) : null}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => reset()} className="biz-btn">
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="biz-btn !bg-transparent !text-[var(--color-biz-text)] ring-1 ring-[var(--color-biz-line)]"
          >
            {isChunk ? "Reload" : "Refresh"}
          </button>
        </div>
      </div>
    </div>
  );
}
