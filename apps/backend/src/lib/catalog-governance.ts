import { isDeployedEnvironment } from "./deployed-environment";

/**
 * Why a script that writes services straight into the database must not run here, or `null` when
 * it may.
 *
 * Such a write is live by the schema's defaults and passes no publish gate, no second admin's
 * approval, no version row and no audit entry. On a developer machine that is how a local catalogue
 * is seeded. On a deployed environment it is a way around every control the admin console enforces,
 * so the scripts ask this first and stop.
 */
/**
 * The four publish flags for a script that inserts a service already on sale, bypassing the admin
 * flow: a local seed, a certification or smoke script on a disposable database. A new row is a draft
 * by default, so such a script has to say this out loud — and saying it is refused on a deployed
 * environment, where a live service comes only from review and approval.
 */
export function directInsertLiveFlags(script: string, env: NodeJS.ProcessEnv = process.env) {
  const refusal = directCatalogWriteRefusal(script, env);
  if (refusal) throw new Error(refusal);
  return { isActive: true, lifecycleStatus: "ACTIVE", isCustomerVisible: true, isBookable: true } as const;
}

export function directCatalogWriteRefusal(script: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isDeployedEnvironment(env)) return null;
  return `${script} inserts services directly into the database, bypassing the publish gate, approval, versioning and audit. It does not run on a deployed environment. Create the service in the admin console and publish it through review.`;
}
