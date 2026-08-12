import { DATA_DISCLOSURE, type DisclosureRow } from "@/lib/legal/legal-data";

function SharedPill({ value }: { value: DisclosureRow["shared"] }) {
  const styles: Record<DisclosureRow["shared"], string> = {
    Yes: "bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-300",
    Limited: "bg-primary/10 text-primary ring-primary/25",
    No: "bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${styles[value]}`}>
      {value}
    </span>
  );
}

/**
 * Google Play "Data safety" style disclosure — premium enterprise table on
 * desktop, stacked cards on mobile. Same data source, one accessible component.
 */
export function DataDisclosureTable() {
  return (
    <div>
      {/* Desktop / tablet: real table */}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-e2 sm:block">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Data disclosure table (scrollable)">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas/60 text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-5 py-3.5 font-semibold">Collected Data</th>
                <th scope="col" className="px-5 py-3.5 font-semibold">Purpose</th>
                <th scope="col" className="px-5 py-3.5 font-semibold">Shared?</th>
                <th scope="col" className="px-5 py-3.5 font-semibold">Retention</th>
              </tr>
            </thead>
            <tbody>
              {DATA_DISCLOSURE.map((row, i) => (
                <tr
                  key={row.data}
                  className={i % 2 ? "bg-canvas/30" : "bg-transparent"}
                >
                  <td className="px-5 py-4 font-semibold text-content">{row.data}</td>
                  <td className="px-5 py-4 text-muted">{row.purpose}</td>
                  <td className="px-5 py-4"><SharedPill value={row.shared} /></td>
                  <td className="px-5 py-4 text-muted">{row.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-3 sm:hidden">
        {DATA_DISCLOSURE.map((row) => (
          <li key={row.data} className="rounded-2xl border border-line bg-surface p-4 shadow-e1">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-content">{row.data}</p>
              <SharedPill value={row.shared} />
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Purpose</dt>
                <dd className="text-muted">{row.purpose}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Retention</dt>
                <dd className="text-muted">{row.retention}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
