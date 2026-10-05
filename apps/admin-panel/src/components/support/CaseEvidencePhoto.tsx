"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, X } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { AdminApiError } from "@/lib/api-error";

/**
 * A photo a customer attached to a complaint case. The bytes sit behind a private admin route, so
 * they are fetched with the admin session and shown from an object URL — never a plain <img src>.
 * The URL is revoked when the component unmounts or the photo changes.
 */
export function CaseEvidencePhoto({ caseId, evidenceId, label }: { caseId: string; evidenceId: number; label: string }) {
  const [open, setOpen] = useState(false);
  const { data: blob, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "case", caseId, "evidence-media", evidenceId],
    queryFn: () => adminApi.cases.evidenceMedia(caseId, evidenceId),
    // The stored object never changes; a missing one stays missing, so it is not retried.
    staleTime: Infinity,
    retry: false,
  });

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [blob]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (isLoading || (blob && !url)) {
    return <span className="biz-skeleton block h-14 w-14 rounded-lg" role="status" aria-label={"Loading " + label} />;
  }

  if (isError || !url) {
    // 404 = the service does not serve this key. Anything else (network, permission) may be worth another try.
    const gone = error instanceof AdminApiError && error.status === 404;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-biz-muted)]">
        <ImageOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Photo unavailable
        {gone ? null : (
          <button type="button" className="underline" onClick={() => void refetch()}>
            Retry
          </button>
        )}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-lg border border-[var(--color-biz-line)] focus:outline-none focus-visible:border-[var(--color-biz-accent)]"
        aria-label={"Open " + label + " full size"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of private bytes; next/image cannot load it */}
        <img src={url} alt={label} className="h-14 w-14 object-cover" />
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-full max-w-4xl rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-3 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">{label}</p>
              <button
                type="button"
                autoFocus
                onClick={() => setOpen(false)}
                aria-label="Close photo"
                className="rounded-md p-1 text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img src={url} alt={label} className="max-h-[78vh] max-w-full rounded-lg object-contain" />
          </div>
        </div>
      ) : null}
    </>
  );
}
