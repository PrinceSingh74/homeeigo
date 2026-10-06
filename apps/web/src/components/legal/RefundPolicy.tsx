import { RotateCcw } from "lucide-react";
import { LegalDocument, type LegalTocItem } from "@/components/legal/LegalDocument";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { LegalKeyPoints, LegalSection } from "@/components/legal/LegalSection";
import { LegalTrustBadges } from "@/components/legal/LegalTrustBadges";
import { RefundTierTable } from "@/components/legal/RefundTierTable";
import { REFUND_SECTIONS, type TrustBadge } from "@/lib/legal/legal-data";
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
