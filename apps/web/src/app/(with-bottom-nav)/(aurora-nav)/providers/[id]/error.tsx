"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ProviderDetailError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/providers"
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-primary"
      >
        <ArrowLeft size={16} /> Back to providers
      </Link>
      <div className="rounded-2xl border border-line bg-surface/70 p-6 text-center">
        <p className="text-sm font-semibold text-content">
          Something went wrong loading this provider.
        </p>
        <p className="mt-2 text-xs text-muted">
          Please try again or pick another provider from the list.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-xl bg-aurora px-4 py-2 text-sm font-bold text-white shadow-glow-blue"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
