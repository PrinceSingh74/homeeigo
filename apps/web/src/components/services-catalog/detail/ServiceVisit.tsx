import type { BackendServiceDetail } from "@/types/backend";
import { DetailSection } from "@/components/services-catalog/detail/sections";
import { cardSurface } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

type Visit = NonNullable<BackendServiceDetail["visit"]>;

/**
 * Renders the backend visit promise. It does not invent safety, proof, warranty or age copy:
 * every sentence is one the API already produced. Headings are labels for a block, never a claim.
 */
export function ServiceVisit({ visit, omitRepeatedRequirements = false }: { visit: Visit; omitRepeatedRequirements?: boolean }) {
  const safety = visit.safety;
  const chemicalRestrictions = safety?.chemicalRestrictions ?? [];
  // The safety block can exist only for its requirements, which the page may already show above.
  const safetyHasContent =
    !!safety &&
    (!!safety.information ||
      (safety.customerRequirements.length > 0 && !omitRepeatedRequirements) ||
      safety.warnings.length > 0 ||
      chemicalRestrictions.length > 0 ||
      !!safety.medicalDisclaimer ||
      !!safety.emergencyProtocol);

  const warranty = visit.warranty;
  const guarantee = warranty?.guarantee?.trim() || null;
  const damagePolicy = warranty?.damagePolicy?.trim() || null;
  const warrantyHasContent = !!warranty && (warranty.statements.length > 0 || warranty.exclusions.length > 0 || !!guarantee || !!damagePolicy);

  return (
    <div className="space-y-10">
      {visit.process.length > 0 && (
        <DetailSection id="visit-process" title="On the visit">
          <ol className="grid gap-3 sm:grid-cols-2">
            {visit.process.map((step, i) => (
              <li key={step.code} className={cn("p-4", cardSurface)}>
                <p className="font-display text-sm font-bold tabular-nums text-brand">{String(i + 1).padStart(2, "0")}</p>
                <p className="mt-2 font-semibold text-content">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.detail}</p>
              </li>
            ))}
          </ol>
        </DetailSection>
      )}

      {safety && safetyHasContent && (
        <DetailSection id="visit-safety" title="Safety">
          <div className={cn("space-y-4 p-5 text-sm leading-relaxed text-content", cardSurface)}>
            {safety.information ? <p>{safety.information}</p> : null}
            {safety.customerRequirements.length > 0 && !omitRepeatedRequirements && (
              <ul className="space-y-2">
                {safety.customerRequirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {safety.warnings.length > 0 && (
              <ul className="list-disc space-y-2 pl-5">
                {safety.warnings.map((item) => (
                  <li key={item} className="break-words">{item}</li>
                ))}
              </ul>
            )}
            {chemicalRestrictions.length > 0 && (
              <div data-testid="visit-chemical-restrictions">
                <h3 className="font-semibold text-content">Products we don&apos;t use, or use with care</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                  {chemicalRestrictions.map((item) => (
                    <li key={item} className="break-words">{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {safety.medicalDisclaimer ? <p className="text-xs text-muted">{safety.medicalDisclaimer}</p> : null}
            {safety.emergencyProtocol ? (
              <p className="text-xs text-muted">In an emergency: {safety.emergencyProtocol}</p>
            ) : null}
          </div>
        </DetailSection>
      )}

      {visit.proof && visit.proof.statements.length > 0 && (
        <DetailSection id="visit-proof" title="Photos of the work">
          <ul className={cn("space-y-2 p-5 text-sm leading-relaxed text-content", cardSurface)}>
            {visit.proof.statements.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </DetailSection>
      )}

      {warranty && warrantyHasContent && (
        <DetailSection id="visit-warranty" title="Cover and complaints">
          <div className={cn("space-y-4 p-5 text-sm leading-relaxed text-content", cardSurface)}>
            {guarantee && (
              <div className="rounded-xl border-l-4 border-brand bg-brand/5 px-4 py-3" data-testid="visit-guarantee">
                <h3 className="text-xs font-bold uppercase tracking-wide text-brand">Our promise</h3>
                <p className="mt-1 break-words font-semibold text-content">{guarantee}</p>
              </div>
            )}
            {warranty.statements.length > 0 && (
              <div className="space-y-3">
                {warranty.statements.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
            {damagePolicy && (
              <div data-testid="visit-damage-policy">
                <h3 className="font-semibold text-content">If something is damaged</h3>
                <p className="mt-2 break-words text-muted">{damagePolicy}</p>
              </div>
            )}
            {warranty.exclusions.length > 0 && (
              <div>
                <h3 className="font-semibold text-content">Not covered</h3>
                <ul className="mt-2 space-y-1 text-muted">
                  {warranty.exclusions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DetailSection>
      )}

      {visit.age && (
        <DetailSection id="visit-age" title="Who can book">
          <p className={cn("p-5 text-sm leading-relaxed text-content", cardSurface)}>{visit.age.statement}</p>
        </DetailSection>
      )}
    </div>
  );
}
