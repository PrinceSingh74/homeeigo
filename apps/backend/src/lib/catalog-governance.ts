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
export function directCatalogWriteRefusal(script: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isDeployedEnvironment(env)) return null;
  return `${script} inserts services directly into the database, bypassing the publish gate, approval, versioning and audit. It does not run on a deployed environment. Create the service in the admin console and publish it through review.`;
}
