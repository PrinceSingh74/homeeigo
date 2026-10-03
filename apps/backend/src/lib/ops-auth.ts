/**
 * Gate operational endpoints (/metrics, /ready).
 *
 * Gated whenever the deployment is not a local developer machine: NODE_ENV=production,
 * APP_ENV=production|staging, or an OPS_AUTH_TOKEN being configured at all. The previous check
 * looked only at NODE_ENV, and `.env.staging` ships NODE_ENV=development / APP_ENV=staging — so a
 * staging host served its financial and integration metrics to anyone who asked.
 */
import { isDeployedEnvironment } from "./deployed-environment";

export function isOpsAuthRequired(): boolean {
  // The deployment test is shared with payment-mocks and routes/auth; see lib/deployed-environment.
  // The extra clause is specific to this gate: configuring an OPS_AUTH_TOKEN at all is taken as
  // intent to require it, even on a laptop.
  if (isDeployedEnvironment()) return true;
  return Boolean(process.env.OPS_AUTH_TOKEN?.trim());
}

export function assertOpsAuthorized(request: Request): boolean {
  if (!isOpsAuthRequired()) return true;

  const token = process.env.OPS_AUTH_TOKEN?.trim();
  if (!token) return false;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  if (bearer && bearer === token) return true;

  const alt = request.headers.get("x-ops-token");
  return alt === token;
}
