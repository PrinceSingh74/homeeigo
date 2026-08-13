import { LegalDocument, type LegalTocItem } from "@/components/legal/LegalDocument";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { LegalKeyPoints, LegalSection } from "@/components/legal/LegalSection";
import { LegalTrustBadges } from "@/components/legal/LegalTrustBadges";
import { DataDisclosureTable } from "@/components/legal/DataDisclosureTable";
import { PRIVACY_SECTIONS, PRIVACY_TRUST_BADGES } from "@/lib/legal/legal-data";
import { getLegalDoc } from "@/lib/legal/legal-docs";

const DOC = getLegalDoc("privacy");
const DISCLOSURE_ID = "data-disclosure";
const DISCLOSURE_TITLE = "Data Disclosure";

/** Contents are derived from the rendered clauses, never hand-listed. */
const TOC: readonly LegalTocItem[] = [
  ...PRIVACY_SECTIONS.map((section) => ({ id: section.id, title: section.title })),
  { id: DISCLOSURE_ID, title: DISCLOSURE_TITLE },
];

export function PrivacyPolicy() {
  return (
    <main>
      <LegalDocument
        doc={DOC}
        toc={TOC}
        header={<LegalTrustBadges badges={PRIVACY_TRUST_BADGES} />}
        footer={<LegalFooterNav current={DOC.href} />}
      >
        {PRIVACY_SECTIONS.map((section, i) => (
          <LegalSection key={section.id} id={section.id} index={i + 1} title={section.title}>
            {section.intro ? <p>{section.intro}</p> : null}
            {section.body ? <p>{section.body}</p> : null}
            {section.items?.length ? <LegalKeyPoints items={section.items} /> : null}
          </LegalSection>
        ))}

        <LegalSection
          id={DISCLOSURE_ID}
          index={PRIVACY_SECTIONS.length + 1}
          title={DISCLOSURE_TITLE}
        >
          <p>
            A plain-language summary of the data HOMEEIGO handles — what we collect, why, whether it
            is shared, and how long we keep it. This mirrors the Google Play Data safety disclosure
            for our mobile apps.
          </p>
          <DataDisclosureTable />
        </LegalSection>
      </LegalDocument>
    </main>
  );
}
