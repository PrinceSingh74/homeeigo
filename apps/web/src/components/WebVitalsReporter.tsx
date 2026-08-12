"use client";

import { useReportWebVitals } from "next/web-vitals";
import { resolveApiBase } from "@/lib/api-base";
import { rumContext } from "@/lib/telemetry/context";

/**
 * Reports Core Web Vitals (LCP, INP, CLS, FCP, TTFB) from the browser to the
 * backend `/api/vitals` ingestion endpoint, which records them as Prometheus
 * histograms → Grafana Customer-Experience dashboard. Uses `sendBeacon` so
 * reports survive page unload.
 */
const KNOWN_VITALS = new Set(["CLS", "LCP", "INP", "FCP", "TTFB", "FID"]);

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (!KNOWN_VITALS.has(metric.name)) return;
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      rating: (metric as { rating?: string }).rating,
      navigationType: metric.navigationType,
      ...rumContext(), // device + network + route (bounded labels)
    });
    const url = `${resolveApiBase()}/api/vitals`;
    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } else {
        void fetch(url, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        });
      }
    } catch {
      // best-effort telemetry — never break the page on a vitals report
    }
  });
  return null;
}
