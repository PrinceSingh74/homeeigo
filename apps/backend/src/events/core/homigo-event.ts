/** CloudEvents-compatible Homigo domain event envelope. */
export type HomigoEventMeta = {
  version: string;
  aggregateType: string;
  aggregateId: string;
  actorType?: "customer" | "partner" | "admin" | "system";
  actorId?: string;
  traceId?: string;
  correlationId?: string;
  causationId?: string;
};

export type HomigoEvent<TData extends Record<string, unknown> = Record<string, unknown>> = {
  specversion: "1.0";
  id: string;
  type: string;
  source: string;
  time: string;
  datacontenttype: "application/json";
  data: TData;
  homigo: HomigoEventMeta;
};

export type EmitEventInput<TData extends Record<string, unknown>> = {
  type: string;
  source: string;
  data: TData;
  homigo: Omit<HomigoEventMeta, "version"> & { version?: string };
};

export function isHomigoEvent(value: unknown): value is HomigoEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as HomigoEvent;
  return (
    e.specversion === "1.0" &&
    typeof e.id === "string" &&
    typeof e.type === "string" &&
    typeof e.source === "string" &&
    typeof e.time === "string" &&
    e.data !== null &&
    typeof e.data === "object" &&
    e.homigo !== null &&
    typeof e.homigo === "object"
  );
}
