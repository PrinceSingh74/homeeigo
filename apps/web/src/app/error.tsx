"use client";

import { useEffect } from "react";
import { getErrorMessage, isChunkLoadError } from "@/lib/error-message";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = getErrorMessage(error);
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    console.error("[HOMIGO]", error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-6 text-center">
      <p className="font-display text-2xl font-bold text-content">Something went wrong</p>
      <p className="mt-3 max-w-md text-sm text-muted">{message}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-content"
        >
          {chunk ? "Reload page" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
