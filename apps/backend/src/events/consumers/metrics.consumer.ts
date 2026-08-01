import { incCounter, observeHist } from "../../lib/metrics";
import type { HomigoEvent } from "../core/homigo-event";

function domainFromType(type: string): string {
  const parts = type.replace(/^homigo\./, "").split(".");
  return parts[0] ?? "unknown";
}

function normalizeEventType(type: string): string {
  return type.replace(/^homigo\./, "");
}

/** Real metrics consumer — low-cardinality Prometheus labels only. */
export async function metricsConsumer(event: HomigoEvent): Promise<void> {
  const eventType = normalizeEventType(event.type);
  const domain = domainFromType(event.type);
  const start = Date.now();

  incCounter("homigo_domain_event_total", { event_type: eventType });
  incCounter("homigo_event_by_domain_total", { domain });

  observeHist("homigo_consumer_metrics_duration_seconds", (Date.now() - start) / 1000, {
    consumer: "metrics.v1",
  });
}

export const METRICS_CONSUMER_NAME = "metrics.v1";
