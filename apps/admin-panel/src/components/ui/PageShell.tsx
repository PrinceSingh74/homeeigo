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
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
