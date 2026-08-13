import { RotateCcw } from "lucide-react";
import { LegalDocument, type LegalTocItem } from "@/components/legal/LegalDocument";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { LegalKeyPoints, LegalSection } from "@/components/legal/LegalSection";
import { LegalStatusPill } from "@/components/legal/LegalStatusPill";
import { LegalTrustBadges } from "@/components/legal/LegalTrustBadges";
import { REFUND_SECTIONS, REFUND_TIERS, type TrustBadge } from "@/lib/legal/legal-data";
import { getLegalDoc } from "@/lib/legal/legal-docs";

const DOC = getLegalDoc("refund");

const BADGES: readonly TrustBadge[] = [
  { label: "Instant wallet refunds", icon: "card" },
  { label: "Free cancellation window", icon: "shield" },
  { label: "Transparent fees", icon: "globe" },
];

const TOC: readonly LegalTocItem[] = REFUND_SECTIONS.map((section) => ({
  id: section.id,
  title: section.title,
}));

/** Cancellation fee tiers — a table on tablet and up, stacked rows on phones. */
function RefundTierTable() {
  return (
    <div>
      <div className="hidden overflow-hidden rounded-xl border border-line bg-surface sm:block">
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Cancellation fee tiers (scrollable)"
        >
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Cancellation fee by how far ahead of the slot you cancel
            </caption>
            <thead>
              <tr className="border-b border-line bg-canvas/70 text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-3 font-semibold">
                  When you cancel
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Cancellation fee
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  What it means
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {REFUND_TIERS.map((tier) => (
                <tr key={tier.window}>
                  <th
                    scope="row"
                    className="px-4 py-3.5 text-left font-semibold text-content"
                  >
                    {tier.window}
                  </th>
                  <td className="px-4 py-3.5">
                    <LegalStatusPill tone={tier.fee === "Free" ? "positive" : "caution"}>
                      {tier.fee}
                    </LegalStatusPill>
                  </td>
                  <td className="px-4 py-3.5 text-muted">{tier.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:hidden">
        {REFUND_TIERS.map((tier) => (
          <li key={tier.window} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[0.9375rem] font-semibold leading-snug text-content">
                {tier.window}
              </p>
              <LegalStatusPill tone={tier.fee === "Free" ? "positive" : "caution"}>
                {tier.fee}
              </LegalStatusPill>
            </div>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">{tier.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RefundPolicy() {
  return (
    <main>
      <LegalDocument
        doc={DOC}
        toc={TOC}
        header={
          <div className="space-y-5">
            <LegalTrustBadges badges={BADGES} />
            <p className="inline-flex items-center gap-2 text-sm font-medium text-muted">
              <RotateCcw size={15} className="text-legal-accent" aria-hidden />
              Most refunds are automatic — no request needed.
            </p>
          </div>
        }
        footer={<LegalFooterNav current={DOC.href} />}
      >
        {REFUND_SECTIONS.map((section, i) => (
          <LegalSection key={section.id} id={section.id} index={i + 1} title={section.title}>
            {section.intro ? <p>{section.intro}</p> : null}
            {section.body ? <p>{section.body}</p> : null}
            {section.id === "customer-cancellations" ? <RefundTierTable /> : null}
            {section.items?.length ? <LegalKeyPoints items={section.items} /> : null}
          </LegalSection>
        ))}
      </LegalDocument>
    </main>
  );
}
