"use client";

import { useEffect } from "react";

/** Root error boundary (login + non-console routes). */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[HOMEEIGO HQ]", error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[var(--color-biz-bg)] px-6 text-center">
      <p className="text-2xl font-bold text-[var(--color-biz-text)]">Something went wrong</p>
      <p className="mt-3 max-w-md text-sm text-[var(--color-biz-muted)]">
        An unexpected error occurred. Please try again.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => reset()} className="biz-btn">
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="biz-btn !bg-transparent !text-[var(--color-biz-text)] ring-1 ring-[var(--color-biz-line)]"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
