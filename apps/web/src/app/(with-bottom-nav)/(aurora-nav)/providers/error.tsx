"use client";

export default function ProvidersError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-10 text-center sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-line bg-surface/70 p-6">
        <p className="text-sm text-muted">Something went wrong loading providers.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-xl bg-aurora px-4 py-2 text-sm font-bold text-white"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
