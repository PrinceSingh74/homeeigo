export function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 biz-page-enter">
      <div className="border-b border-[var(--color-biz-line)] pb-4">
        <h1 className="biz-display text-2xl font-bold tracking-tight md:text-[1.75rem]">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-biz-muted)]">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
