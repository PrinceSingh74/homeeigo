export default function ProvidersLoading() {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 h-8 w-56 animate-pulse rounded bg-surface/70" />
      <div className="mb-6 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-surface/70" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-[24px] bg-surface/70" />
        ))}
      </div>
    </div>
  );
}
