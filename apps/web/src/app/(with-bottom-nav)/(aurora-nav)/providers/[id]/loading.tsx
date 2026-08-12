export default function ProviderDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-surface/70" />
      <div className="h-44 animate-pulse rounded-[28px] bg-surface/70" />
      <div className="mt-6 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface/70" />
        ))}
      </div>
      <div className="mt-8 h-44 animate-pulse rounded-[24px] bg-surface/70" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface/70" />
        ))}
      </div>
    </div>
  );
}
