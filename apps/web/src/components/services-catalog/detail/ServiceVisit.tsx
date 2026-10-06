import { Camera } from "lucide-react";
import type { BackendServiceDetail } from "@/types/backend";
import { DetailSection, MintBand } from "@/components/services-catalog/detail/sections";
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

  const proof = visit.proof && visit.proof.statements.length > 0 ? visit.proof : null;
  const steps = visit.process;
  // A horizontal line of stops only reads well for a handful; longer processes stay vertical.
  const horizontal = steps.length >= 2 && steps.length <= 5;

  // "Photos of the work" is a sentence or two, so it rides with the visit (or, when there is no
  // process to attach it to, with the cover) instead of standing alone as a section.
  const proofNote = proof && (
    <div className="flex max-w-2xl gap-4" role="group" aria-labelledby="visit-proof">
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-brand dark:bg-emerald-500/10">
        <Camera className="size-5" strokeWidth={1.75} />
      </span>
      <div className="text-base leading-relaxed">
        <h3 id="visit-proof" className="font-semibold text-content">
          Photos of the work
        </h3>
        <ul className="mt-1 space-y-1 text-muted">
          {proof.statements.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="space-y-10 sm:space-y-12">
      {steps.length > 0 && (
        <DetailSection id="visit-process" title="On the visit">
          <ol className={cn("relative", horizontal && "xl:grid xl:auto-cols-fr xl:grid-flow-col")}>
            {steps.map((step, i) => {
              const last = i === steps.length - 1;
              return (
                <li
                  key={step.code}
                  className={cn(
                    "relative grid grid-cols-[2.5rem_1fr] gap-x-4 pb-7 last:pb-0",
                    // The connector: down the left on small screens, along the top on wide ones.
                    !last && "before:absolute before:bottom-0 before:left-5 before:top-10 before:w-px before:bg-emerald-700/30 dark:before:bg-emerald-400/30",
                    horizontal && "xl:block xl:pb-0 xl:pr-8",
                    horizontal &&
                      !last &&
                      "xl:before:bottom-auto xl:before:left-10 xl:before:right-0 xl:before:top-5 xl:before:h-px xl:before:w-auto",
                  )}
                >
                  <span
                    aria-hidden
                    className="relative grid size-10 place-items-center rounded-full border-2 border-emerald-700 bg-surface font-display text-base font-bold tabular-nums text-brand dark:border-emerald-400"
                  >
                    {i + 1}
                  </span>
                  <div className={cn("pt-1.5", horizontal && "xl:pt-4")}>
                    <p className="font-display text-lg font-semibold text-content">{step.title}</p>
                    <p className="mt-1 text-base leading-relaxed text-muted">{step.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          {proofNote && <div className="mt-8 border-t border-line pt-6">{proofNote}</div>}
        </DetailSection>
      )}

      {safety && safetyHasContent && (
        <section aria-labelledby="visit-safety" className="scroll-mt-32">
          <MintBand>
            <h2 id="visit-safety" className="font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
              Safety
            </h2>
            <div className="mt-4 space-y-5">
              {safety.information ? <p className="max-w-3xl">{safety.information}</p> : null}
              {safety.customerRequirements.length > 0 && !omitRepeatedRequirements && (
                <ul className="max-w-3xl space-y-2">
                  {safety.customerRequirements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {(safety.warnings.length > 0 || chemicalRestrictions.length > 0) && (
                <div className="grid gap-x-12 gap-y-5 md:grid-cols-2">
                  {safety.warnings.length > 0 && (
                    <ul className="list-disc space-y-2 pl-5 font-medium marker:text-emerald-700 dark:marker:text-emerald-400">
                      {safety.warnings.map((item) => (
                        <li key={item} className="break-words">{item}</li>
                      ))}
                    </ul>
                  )}
                  {chemicalRestrictions.length > 0 && (
                    <div data-testid="visit-chemical-restrictions">
                      <h3 className="font-semibold text-content">Products we don&apos;t use, or use with care</h3>
                      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted marker:text-emerald-700 dark:marker:text-emerald-400">
                        {chemicalRestrictions.map((item) => (
                          <li key={item} className="break-words">{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {(safety.medicalDisclaimer || safety.emergencyProtocol) && (
                <div className="space-y-3 border-t border-emerald-700/20 pt-5 dark:border-emerald-400/20">
                  {/* A disclaimer limits what the service is: readable, but not louder than the rest. */}
                  {safety.medicalDisclaimer ? <p className="max-w-3xl text-sm text-muted">{safety.medicalDisclaimer}</p> : null}
                  {/* What happens in an emergency is something to act on: full size and weight. */}
                  {safety.emergencyProtocol ? (
                    <p className="max-w-3xl font-semibold text-content">In an emergency: {safety.emergencyProtocol}</p>
                  ) : null}
                </div>
              )}
            </div>
          </MintBand>
        </section>
      )}

      {warranty && warrantyHasContent && (
        <DetailSection id="visit-warranty" title="Cover and complaints">
          {guarantee && (
            <figure className="border-l-4 border-emerald-700 pl-5 dark:border-emerald-400 sm:pl-7" data-testid="visit-guarantee">
              <figcaption>
                <h3 className="text-sm font-semibold text-brand">Our promise</h3>
              </figcaption>
              <blockquote className="mt-2 max-w-3xl break-words font-display text-xl font-semibold leading-snug tracking-tight text-content sm:text-2xl sm:leading-snug">
                {guarantee}
              </blockquote>
            </figure>
          )}
          {warranty.statements.length > 0 && (
            <ul className={cn("max-w-3xl divide-y divide-line text-base leading-relaxed text-content", guarantee && "mt-7")}>
              {warranty.statements.map((line) => (
                <li key={line} className="py-3 first:pt-0">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {(damagePolicy || warranty.exclusions.length > 0) && (
            <div className="mt-7 grid gap-x-12 gap-y-6 border-t border-line pt-6 text-sm leading-relaxed md:grid-cols-2">
              {damagePolicy && (
                <div data-testid="visit-damage-policy" className={cn(warranty.exclusions.length === 0 && "max-w-3xl md:col-span-2")}>
                  <h3 className="font-semibold text-content">If something is damaged</h3>
                  <p className="mt-1.5 break-words text-muted">{damagePolicy}</p>
                </div>
              )}
              {warranty.exclusions.length > 0 && (
                <div>
                  <h3 className="font-semibold text-content">Not covered</h3>
                  <ul className="mt-1.5 space-y-1 text-muted">
                    {warranty.exclusions.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {!steps.length && proofNote && <div className="mt-7 border-t border-line pt-6">{proofNote}</div>}
        </DetailSection>
      )}

      {!steps.length && !(warranty && warrantyHasContent) && proofNote && (
        <div className="border-t border-line pt-8">{proofNote}</div>
      )}

      {visit.age && (
        <DetailSection id="visit-age" title="Who can book">
          <p className="max-w-2xl text-base leading-relaxed text-content">{visit.age.statement}</p>
        </DetailSection>
      )}
    </div>
  );
}
