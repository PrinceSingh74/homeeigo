"use client";

import { memo, useMemo } from "react";
import { Brain, MapPinned } from "lucide-react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { SurgeZone, DemandForecast, FraudData, RevenueForecast, ZoneScoring, ZoneScore } from "@/services/admin-api";
import { Icon3D } from "@/components/hq/Icon3D";
import { cn } from "@/lib/cn";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const KNOWN_CITIES = [
  "New Delhi",
  "Delhi",
  "Noida",
  "Gurugram",
  "Gurgaon",
  "Ghaziabad",
  "Faridabad",
  "Greater Noida",
  "Bangalore",
  "Bengaluru",
  "Mumbai",
  "Pune",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Jaipur",
  "Ahmedabad",
  "Lucknow",
  "Chandigarh",
  "Indore",
  "Surat",
  "Kanpur",
  "Nagpur",
  "Patna",
  "Bhopal",
  "Coimbatore",
  "Kochi",
  "Goa",
];

const CITY_ALIAS: Record<string, string> = {
  gurgaon: "Gurugram",
  bengaluru: "Bangalore",
  "new delhi": "Delhi",
};

type CityRow = {
  key: string;
  city: string;
  area: string;
  surge: number;
  demand: number;
  revenue: number;
  risk: number;
};

function tidy(value: string) {
  return value
    .replace(/\b(polygon|geofence|smoke zone|ncr|zone)\b/gi, " ")
    .replace(/[—–_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalCity(value: string) {
  const hit = KNOWN_CITIES.find((c) => value.toLowerCase().includes(c.toLowerCase()));
  if (!hit) return "";
  return CITY_ALIAS[hit.toLowerCase()] ?? hit;
}

function parsePlace(city: string | null, name: string) {
  const fromField = city?.trim() ? canonicalCity(city) || tidy(city) : "";
  const fromName = canonicalCity(name);
  const resolved = fromField || fromName || tidy(name) || "Unknown";
  let area = tidy(name);
  for (const token of [resolved, city ?? ""]) {
    if (!token) continue;
    area = area.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ").trim();
  }
  area = tidy(area);
  if (!area || area.toLowerCase() === resolved.toLowerCase()) area = "";
  return { city: resolved, area };
}

function toCityRows(ranked: ZoneScore[], surge: SurgeZone[]): CityRow[] {
  const surgeByZone = new Map(surge.map((s) => [s.zoneId, s.predictedSurge]));
  const byCity = new Map<string, CityRow>();

  for (const z of ranked) {
    const place = parsePlace(z.city, z.name);
    const key = place.city.toLowerCase();
    const next: CityRow = {
      key,
      city: place.city,
      area: place.area,
      surge: surgeByZone.get(z.zoneId) ?? 1,
      demand: z.demand24h,
      revenue: z.revenue24h,
      risk: z.riskScore,
    };
    const prev = byCity.get(key);
    if (!prev) {
      byCity.set(key, next);
      continue;
    }
    prev.surge = Math.max(prev.surge, next.surge);
    prev.demand += next.demand;
    prev.revenue += next.revenue;
    prev.risk = Math.max(prev.risk, next.risk);
    if (prev.area && next.area && prev.area !== next.area) prev.area = "";
  }

  return [...byCity.values()].sort((a, b) => b.surge - a.surge || b.demand - a.demand);
}

function statusOf(surge: number): { label: string; tone: "hot" | "warm" | "good" } {
  if (surge >= 2) return { label: "High surge", tone: "hot" };
  if (surge >= 1.4) return { label: "Busy", tone: "warm" };
  return { label: "Stable", tone: "good" };
}

function AiIntelligencePanelInner({
  surge,
  demand,
  fraud,
  revenue,
  zones,
}: {
  surge?: SurgeZone[];
  demand?: DemandForecast;
  fraud?: FraudData;
  revenue?: RevenueForecast;
  zones?: ZoneScoring;
}) {
  useRenderProbe("AiIntelligencePanel");
  useMountProbe("AiIntelligencePanel");

  const rows = useMemo(
    () => toCityRows(zones?.ranked ?? [], surge ?? []),
    [zones?.ranked, surge],
  );

  const peak = rows[0];
  const insight = peak
    ? `${peak.city} is hottest right now — surge ×${peak.surge}. ${rows.length} cities on the board.`
    : "No city telemetry yet.";

  return (
    <aside className="cmd-card cmd-intel-board">
      <header className="cmd-intel-head">
        <div className="cmd-intel-head-copy">
          <p className="cmd-mini-label">Intelligence</p>
          <h2>AI Insights</h2>
        </div>
        <Icon3D icon={Brain} tone="cyan" size="md" />
      </header>

      <article className={cn("cmd-insight-hero", peak && peak.surge >= 1.4 ? "cmd-insight-hero--hot" : "")}>
        <p className="cmd-insight-kicker">Now</p>
        <p className="cmd-insight-body">{insight}</p>
      </article>

      <section className="cmd-city-board">
        <div className="cmd-city-head">
          <span className="cmd-city-head-title">
            <Icon3D icon={MapPinned} tone="success" size="sm" />
            All cities
          </span>
          <span className="cmd-city-count">{rows.length}</span>
        </div>

        <ul className="cmd-city-list">
          {rows.length ? (
            rows.map((r, i) => {
              const status = statusOf(r.surge);
              return (
                <li key={r.key} className="cmd-city-card">
                  <div className="cmd-city-index">{String(i + 1).padStart(2, "0")}</div>
                  <div className="cmd-city-main">
                    <div className="cmd-city-title-row">
                      <strong>{r.city}</strong>
                      <span className={cn("cmd-city-status", `is-${status.tone}`)}>{status.label}</span>
                    </div>
                    {r.area ? <p className="cmd-city-area">{r.area}</p> : null}
                    <div className="cmd-city-stats">
                      <span>
                        Surge <b className={cn(status.tone !== "good" && `is-${status.tone}`)}>×{r.surge}</b>
                      </span>
                      <span>
                        Jobs <b>{r.demand}</b>
                      </span>
                      <span>
                        Revenue <b>{inr(r.revenue)}</b>
                      </span>
                    </div>
                  </div>
                </li>
              );
            })
          ) : (
            <li className="cmd-city-empty">No city telemetry yet.</li>
          )}
        </ul>
      </section>
    </aside>
  );
}

export const AiIntelligencePanel = memo(AiIntelligencePanelInner);
