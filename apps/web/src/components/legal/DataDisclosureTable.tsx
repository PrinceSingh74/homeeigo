import { LegalStatusPill, type LegalPillTone } from "@/components/legal/LegalStatusPill";
import { DATA_DISCLOSURE, type DisclosureRow } from "@/lib/legal/legal-data";

const SHARED_TONE: Record<DisclosureRow["shared"], LegalPillTone> = {
  Yes: "caution",
  Limited: "info",
  No: "positive",
};

/**
 * Google Play "Data safety" style disclosure — a real table on tablet and up,
 * stacked rows on phones. One data source, one accessible component.
 */
export function DataDisclosureTable() {
  return (
    <div>
      <div className="hidden overflow-hidden rounded-xl border border-line bg-surface sm:block">
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Data disclosure table (scrollable)"
        >
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Data collected, why it is used, whether it is shared, and how long it is retained
            </caption>
            <thead>
              <tr className="border-b border-line bg-canvas/70 text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Collected Data
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Purpose
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Shared?
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Retention
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {DATA_DISCLOSURE.map((row) => (
                <tr key={row.data}>
                  <th scope="row" className="px-4 py-3.5 text-left font-semibold text-content">
                    {row.data}
                  </th>
                  <td className="px-4 py-3.5 text-muted">{row.purpose}</td>
                  <td className="px-4 py-3.5">
                    <LegalStatusPill tone={SHARED_TONE[row.shared]}>{row.shared}</LegalStatusPill>
                  </td>
                  <td className="px-4 py-3.5 text-muted">{row.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:hidden">
        {DATA_DISCLOSURE.map((row) => (
          <li key={row.data} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[0.9375rem] font-semibold leading-snug text-content">{row.data}</p>
              <LegalStatusPill tone={SHARED_TONE[row.shared]}>{row.shared}</LegalStatusPill>
            </div>
            <dl className="mt-3 space-y-2 text-[0.9375rem]">
              <div className="flex gap-3">
                <dt className="w-[4.5rem] shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
                  Purpose
                </dt>
                <dd className="min-w-0 flex-1 leading-relaxed text-muted">{row.purpose}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-[4.5rem] shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
                  Retention
                </dt>
                <dd className="min-w-0 flex-1 leading-relaxed text-muted">{row.retention}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
