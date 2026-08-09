"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary for the partner console. A crash in any (partner)
 * route renders this graceful recover panel instead of a white screen.
 */
export default function PartnerError({
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
    console.error("[HOMEEIGO Partner]", error);
  }, [error]);

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-partner-primary/15 ring-1 ring-partner-primary/25">
        <span className="text-2xl" aria-hidden>⚠️</span>
      </div>
      <p className="mt-5 font-display text-xl font-bold text-white">Something went wrong</p>
      <p className="mt-2 max-w-md text-sm text-partner-text-secondary">
        {isChunk
          ? "A newer version is available. Reload to continue."
          : "This screen hit an unexpected error. You can retry or reload."}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-partner-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5"
        >
          {isChunk ? "Reload" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
