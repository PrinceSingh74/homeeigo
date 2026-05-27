/** Route loading shell — visible so the page never looks “blank”. */
export default function RootLoading() {
  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-canvas px-6"
      aria-busy="true"
      aria-label="Loading HOMIGO"
    >
      <div
        className="size-11 animate-pulse rounded-2xl bg-aurora shadow-glow-blue"
        aria-hidden
      />
      <p className="font-display text-lg font-bold text-aurora">HOMIGO</p>
      <p className="text-sm text-muted">Loading…</p>
    </div>
  );
}
