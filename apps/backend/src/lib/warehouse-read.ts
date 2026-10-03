/**
 * The warehouse-read boundary — one place that decides what a failed data-warehouse read means.
 *
 * ── Why this exists (X-84 class) ────────────────────────────────────────────────────────────────
 *
 * Every module that reads the warehouse (geo-intel's vertex-ai service, mlops, the analytics
 * forecast / evaluation / baseline services, the feature store) keeps its own BigQuery client, and
 * none of them had a boundary between "the warehouse did not answer" and the HTTP response. So an
 * outage — no credentials on a zero-egress stack, billing disabled on live, a refused connection, a
 * hang — became an unhandled 500 on thirteen admin routes and a partner page (X-84, X-86, X-88), a
 * throw out of the one method documented as never throwing (X-89), and a 0% data-quality score
 * nobody measured (X-90).
 *
 * `readWarehouse` is that boundary for HTTP reads: it answers the value, or a stated unavailability
 * that carries a reason code and a diagnostic cause and NO figures. It absorbs outages only. A query
 * that is itself wrong (404 table not found, 400 invalid query) or a programming error is a defect,
 * and hiding it behind "unavailable" would keep it from ever being fixed — those still throw.
 */
import { connectionFailureCode } from "./connection-errors";
import { WarehouseEgressRefusedError } from "./bigquery-adc";
import { logger } from "./logger";

/** Reason code for "the demand-forecast source did not answer" — shared by every forecast surface. */
export const DEMAND_FORECAST_UNAVAILABLE = "FORECAST_SOURCE_UNAVAILABLE" as const;

/** The warehouse did not answer inside the deadline. */
export class WarehouseTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Warehouse query did not answer within ${timeoutMs}ms`);
  }
}

/** The warehouse answered, but not with rows of the shape the query selects. */
export class WarehouseMalformedResponseError extends Error {}

export type WarehouseFailureCause = "CREDENTIALS" | "CONNECTION" | "TIMEOUT" | "MALFORMED_RESPONSE" | "UPSTREAM_ERROR";

/**
 * Which way the warehouse failed — diagnostic only; every cause means the same thing to a reader:
 * there is no answer. Anything unrecognised (including the client's own retries being exhausted,
 * which surfaces as its last 5xx / 429) is `UPSTREAM_ERROR`.
 */
export function classifyWarehouseFailure(err: unknown): WarehouseFailureCause {
  if (err instanceof WarehouseTimeoutError) return "TIMEOUT";
  if (err instanceof WarehouseMalformedResponseError) return "MALFORMED_RESPONSE";
  if (err instanceof WarehouseEgressRefusedError) return "CREDENTIALS";
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Could not load the default credentials")) return "CREDENTIALS";
  if (connectionFailureCode(err)) return "CONNECTION";
  return "UPSTREAM_ERROR";
}

/** BigQuery `errors[].reason` values that mean "the service would not answer", not "your query is wrong". */
const OUTAGE_REASONS = new Set([
  "backendError", "internalError", "rateLimitExceeded", "quotaExceeded", "billingNotEnabled",
  "accessDenied", "responseTooLarge", "resourcesExceeded", "timeout", "jobBackendError",
]);

/**
 * True when the warehouse did not give an answer; false when the request itself is at fault.
 * 403 counts as an outage: on live the warehouse's billing is disabled (billingNotEnabled /
 * accessDenied), and no request change could make it answer.
 */
export function isWarehouseOutage(err: unknown): boolean {
  const cause = classifyWarehouseFailure(err);
  if (cause !== "UPSTREAM_ERROR") return true;
  const e = err as { code?: unknown; errors?: Array<{ reason?: unknown }> } | null;
  const status = typeof e?.code === "number" ? e.code : null;
  if (status !== null && (status === 403 || status === 429 || status >= 500)) return true;
  return Array.isArray(e?.errors) && e!.errors.some((x) => typeof x?.reason === "string" && OUTAGE_REASONS.has(x.reason));
}

/** Upper bound on one warehouse read, in ms. `BQ_QUERY_TIMEOUT_MS` overrides the 15 s default. */
export function warehouseQueryTimeoutMs(): number {
  const v = Number(process.env.BQ_QUERY_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 15_000;
}

/**
 * Bound a warehouse read. Client-side only, on purpose: passing `jobTimeoutMs` to the BigQuery client
 * disqualifies its fast `jobs.query` path (bigquery.js) and slows every healthy call. The losing
 * promise is left to settle; the timer is always cleared.
 */
export async function withWarehouseDeadline<T>(read: Promise<T>, timeoutMs = warehouseQueryTimeoutMs()): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WarehouseTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Throws `WarehouseMalformedResponseError` unless the client handed back a row array. */
export function assertRowArray<T>(rows: unknown, what: string): T[] {
  if (!Array.isArray(rows)) throw new WarehouseMalformedResponseError(`${what} returned no row array`);
  return rows as T[];
}

export type WarehouseUnavailable<R extends string> = {
  available: false;
  reasonCode: R;
  cause: WarehouseFailureCause;
  reason: string;
  data: null;
};

export type WarehouseRead<T, R extends string> = { available: true; value: T } | WarehouseUnavailable<R>;

/** The unavailability for an outage `err`, or `null` when `err` is a defect that must keep throwing. */
export function warehouseUnavailable<R extends string>(
  err: unknown,
  opts: { reasonCode: R; logEvent: string; reason: string },
): WarehouseUnavailable<R> | null {
  if (!isWarehouseOutage(err)) return null;
  const cause = classifyWarehouseFailure(err);
  logger.warn(opts.logEvent, { cause, error: String(err).slice(0, 200) });
  return { available: false, reasonCode: opts.reasonCode, cause, reason: opts.reason, data: null };
}

/** Run a warehouse read for an HTTP route: the value, or a stated outage. Defects still throw. */
export async function readWarehouse<T, R extends string>(
  run: () => Promise<T>,
  opts: { reasonCode: R; logEvent: string; reason: string; deadlineMs?: number },
): Promise<WarehouseRead<T, R>> {
  try {
    return { available: true, value: await withWarehouseDeadline(run(), opts.deadlineMs) };
  } catch (err) {
    const unavailable = warehouseUnavailable(err, opts);
    if (!unavailable) throw err;
    return unavailable;
  }
}
