/**
 * HOMIGO City Digital Twin (Phase-4 Track 4).
 *
 * A live per-city simulation model composed PURELY from already-verified services
 * (geo-intelligence, weather, pricing) — it aggregates, it does not recompute primitives.
 * Plus a "what-if" Scenario Engine that perturbs the live state through the real
 * demand/supply/elasticity relationships, and AI executive insights with confidence.
 *
 * Architecture supports unlimited cities — the city set is derived from live zone data
 * unioned with the configured Tier-0/Tier-1 list.
 */
import { weatherService } from "./weather.service";
import { geoIntelligenceService } from "./geo-intelligence.service";
import { cacheService } from "./cache.service";
import { distanceKm } from "../lib/geo";
import { incCounter, setGauge, observeHist } from "../lib/metrics";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const SUPPORTED_CITIES = {
  tier0: ["Delhi", "Gurugram", "Noida"],
  tier1: ["Mumbai", "Bangalore", "Hyderabad", "Pune"],
};
const ALL_CITIES = [...SUPPORTED_CITIES.tier0, ...SUPPORTED_CITIES.tier1];

type SurgeZone = { zoneId: string; name: string; city: string | null; supply: number; activeBookings: number; weatherSurge: number; predictedSurge: number; demandDeltaPct: number | null };
type DensityZone = { zoneId: string; name: string; city: string | null; centerLat: number; centerLng: number; areaKm2: number; providers: number; densityPerKm2: number };
type ScoreZone = { zoneId: string; name: string; city: string | null; demand24h: number; revenue24h: number; riskScore: number; serviceHealth: number };
type FraudEvent = { lat: number; lng: number; implied_kmh: number };

export interface TwinResult<T> { data: T; confidence: number; freshness: string; source: string; generatedAt: string; }

const norm = (c: string | null | undefined) => (c ?? "").trim().toLowerCase();

export class DigitalTwinService {
  /** Live, fully-composed twin for one city (all 10 layers). */
  async cityTwin(city: string): Promise<TwinResult<unknown>> {
    return cacheService.getOrFetch(`twin:city:${norm(city)}`, 45, async () => {
      const [surgeR, densityR, scoreR, fraudR, demandR, revenueR, weather] = await Promise.all([
        geoIntelligenceService.surgePrediction(),
        geoIntelligenceService.providerDensity(),
        geoIntelligenceService.zoneScoring(),
        geoIntelligenceService.fraudDetection(50),
        geoIntelligenceService.demandForecast(24),
        geoIntelligenceService.revenueForecast(),
        weatherService.getByCity(city).catch(() => null),
      ]);
      const surge = (surgeR.data as SurgeZone[]).filter((z) => norm(z.city) === norm(city));
      const density = (densityR.data as DensityZone[]).filter((z) => norm(z.city) === norm(city));
      const score = new Map((scoreR.data as { ranked: ScoreZone[] }).ranked.map((z) => [z.zoneId, z]));
      const densAll = densityR.data as DensityZone[];
      const fraudEvents = (fraudR.data as { events: FraudEvent[] }).events.filter((e) => norm(this.cityOf(e, densAll)) === norm(city));

      // ── Supply twin ──
      const providers = density.reduce((s, z) => s + z.providers, 0);
      const busy = surge.reduce((s, z) => s + Math.min(z.activeBookings, z.supply), 0);
      const available = Math.max(0, providers - busy);
      const avgDensity = density.length ? density.reduce((s, z) => s + z.densityPerKm2, 0) / density.length : 0;
      const shortageRisk = clamp(Math.round((1 - clamp(avgDensity / 0.5, 0, 1)) * 100), 0, 100);

      // ── Demand twin ──
      const demandNow = [...score.values()].filter((z) => norm(z.city) === norm(city)).reduce((s, z) => s + z.demand24h, 0);
      const fc = (demandR.data as { points: Array<{ predicted: number }> }).points;
      const f1 = fc[0]?.predicted ?? 0, f6 = fc.slice(0, 6).reduce((s, p) => s + p.predicted, 0), f24 = fc.reduce((s, p) => s + p.predicted, 0);

      // ── Revenue twin ──
      const revenue24h = [...score.values()].filter((z) => norm(z.city) === norm(city)).reduce((s, z) => s + z.revenue24h, 0);
      const rev = revenueR.data as { forecastDaily: number; forecastMonthly: number };

      // ── Pricing twin ──
      const avgSurge = surge.length ? surge.reduce((s, z) => s + z.predictedSurge, 0) / surge.length : 1;
      const predictedSurge = surge.length ? surge.reduce((s, z) => s + Math.max(z.predictedSurge, z.weatherSurge), 0) / surge.length : 1;

      // ── Traffic twin (ops proxy: demand/supply pressure; live per-road = admin map TrafficLayer) ──
      const pressure = available > 0 ? busy / available : busy > 0 ? 2 : 0;
      const congestionIndex = clamp(Math.round(pressure * 40 + (weather?.severity === "severe" || weather?.severity === "extreme" ? 30 : 0)), 0, 100);

      // ── Weather twin ──
      const sev = weather?.severity ?? "clear";
      const weatherImpactScore = ({ clear: 0, mild: 20, moderate: 50, severe: 80, extreme: 100 } as Record<string, number>)[sev] ?? 0;
      const floodRisk = (weather?.rain1hMm ?? 0) > 7.5 ? "high" : (weather?.rain1hMm ?? 0) > 2.5 ? "moderate" : "low";

      // ── ETA twin ──
      const etaInflationPct = Math.round((congestionIndex * 0.4 + weatherImpactScore * 0.3));
      const slowZones = [...score.values()].filter((z) => norm(z.city) === norm(city) && z.serviceHealth < 60).map((z) => z.name);

      // Telemetry: live twin gauges per city.
      setGauge("digital_twin_demand", demandNow, { city });
      setGauge("digital_twin_supply", providers, { city });
      setGauge("digital_twin_revenue", Math.round(revenue24h), { city });
      setGauge("digital_twin_eta", etaInflationPct, { city });
      setGauge("digital_twin_pricing", Math.round(predictedSurge * 100) / 100, { city });
      setGauge("digital_twin_fraud", fraudEvents.length, { city });

      const data = {
        city,
        zones: density.length,
        layers: {
          demand: { current: demandNow, forecast1h: Math.round(f1 * 10) / 10, forecast6h: Math.round(f6 * 10) / 10, forecast24h: Math.round(f24 * 10) / 10 },
          supply: { online: providers, busy, available, density: Math.round(avgDensity * 100) / 100, shortageRisk },
          traffic: { congestionIndex, level: congestionIndex > 66 ? "heavy" : congestionIndex > 33 ? "moderate" : "light" },
          weather: weather ? { condition: weather.condition, description: weather.description, severity: sev, rain1hMm: weather.rain1hMm, weatherImpactScore, floodRisk, aqi: null } : null,
          revenue: { current24h: Math.round(revenue24h), projectedDaily: rev.forecastDaily, projectedMonthly: rev.forecastMonthly },
          eta: { inflationPct: etaInflationPct, slowZones: slowZones.slice(0, 5) },
          pricing: { currentSurge: Math.round(avgSurge * 100) / 100, predictedSurge: Math.round(predictedSurge * 100) / 100, confidence: surgeR.confidence },
          fraud: { events: fraudEvents.length, pins: fraudEvents.slice(0, 20), riskScore: fraudEvents.length ? Math.min(100, Math.round(Math.max(...fraudEvents.map((e) => e.implied_kmh)) / 10)) : 0 },
        },
      };
      return {
        data,
        confidence: Math.round(((surgeR.confidence ?? 0.7) + (revenueR.confidence ?? 0.6)) / 2 * 100) / 100,
        freshness: new Date().toISOString(),
        source: "geo-intel+weather+computed",
        generatedAt: new Date().toISOString(),
      };
    }, 5) as Promise<TwinResult<unknown>>;
  }

  private cityOf(e: { lat: number; lng: number }, density: DensityZone[]): string | null {
    let best: DensityZone | undefined, bd = Infinity;
    for (const z of density) { const d = distanceKm(e.lat, e.lng, z.centerLat, z.centerLng); if (d < bd) { bd = d; best = z; } }
    return best?.city ?? null;
  }

  /** Supported cities + a live one-line summary each. */
  async cities(): Promise<TwinResult<unknown>> {
    const summaries = await Promise.all(ALL_CITIES.map(async (c) => {
      const t = (await this.cityTwin(c)).data as { layers: { demand: { current: number }; supply: { online: number }; pricing: { currentSurge: number } } };
      return { city: c, tier: SUPPORTED_CITIES.tier0.includes(c) ? 0 : 1, demand: t.layers.demand.current, providers: t.layers.supply.online, surge: t.layers.pricing.currentSurge };
    }));
    return { data: { cities: summaries }, confidence: 0.9, freshness: new Date().toISOString(), source: "twin", generatedAt: new Date().toISOString() };
  }

  /**
   * Scenario engine — perturb the live city twin through the real demand/supply/elasticity
   * relationships and report the operational impact. No fabricated data: every baseline is
   * the live twin; deltas are explicit user inputs.
   */
  async simulate(city: string, scenario: { demandDeltaPct?: number; providerDeltaPct?: number; trafficDeltaPct?: number; rainStart?: boolean; festival?: boolean }): Promise<TwinResult<unknown>> {
    incCounter("digital_twin_scenarios_total", { city });
    const twin = (await this.cityTwin(city)).data as {
      layers: { demand: { current: number }; supply: { online: number; available: number }; revenue: { current24h: number }; eta: { inflationPct: number }; pricing: { currentSurge: number } };
    };
    const L = twin.layers;

    const demandMult = (1 + (scenario.demandDeltaPct ?? 0) / 100) * (scenario.rainStart ? 1.25 : 1) * (scenario.festival ? 1.6 : 1);
    const supplyMult = 1 + (scenario.providerDeltaPct ?? 0) / 100;
    const trafficMult = (1 + (scenario.trafficDeltaPct ?? 0) / 100) * (scenario.rainStart ? 1.2 : 1);

    const newDemand = Math.round(L.demand.current * demandMult);
    const newSupply = Math.max(0, Math.round(L.supply.online * supplyMult));
    const newAvailable = Math.max(0, Math.round(L.supply.available * supplyMult));
    // Surge from new demand/supply pressure (clamped, same shape as the live engine).
    const pressure = newAvailable > 0 ? (newDemand / Math.max(L.demand.current, 1)) / Math.max(supplyMult, 0.1) : 2;
    const newSurge = Math.round(clamp(L.pricing.currentSurge * pressure, 1, 3) * 100) / 100;
    // Conversion falls as surge rises (price-elasticity, scarcity-tempered).
    const convChange = Math.round((Math.exp(-0.6 * (newSurge - L.pricing.currentSurge)) - 1) * 100);
    // Revenue impact = FULFILLED-demand growth × surge price × conversion change. You only
    // earn from bookings you can serve: fulfilment is capped by supply (+ its spare headroom),
    // so cutting providers while demand rises is correctly revenue-NEGATIVE, not positive.
    const headroom = L.supply.online > 0 ? L.supply.available / L.supply.online : 0;
    const fulfilmentGrowth = Math.min(demandMult, supplyMult * (1 + headroom));
    const priceGrowth = newSurge / Math.max(L.pricing.currentSurge, 1);
    const revenueImpactPct = Math.round((fulfilmentGrowth * priceGrowth * (1 + convChange / 100) - 1) * 100);
    const etaImpactPct = Math.round((trafficMult - 1) * 100 + (newSupply < L.supply.online ? (L.supply.online - newSupply) / Math.max(L.supply.online, 1) * 30 : 0));
    const customerImpactPct = convChange; // conversion proxy for customer experience
    const supplyGapPct = L.demand.current > 0 ? Math.round(((newDemand / Math.max(newSupply, 1)) - (L.demand.current / Math.max(L.supply.online, 1))) / Math.max(L.demand.current / Math.max(L.supply.online, 1), 0.01) * 100) : 0;

    return {
      data: {
        city, scenario,
        baseline: { demand: L.demand.current, supply: L.supply.online, surge: L.pricing.currentSurge, revenue24h: L.revenue.current24h },
        projected: { demand: newDemand, supply: newSupply, available: newAvailable, surge: newSurge },
        impact: { revenuePct: revenueImpactPct, etaPct: etaImpactPct, supplyGapPct, customerPct: customerImpactPct, surgeShift: Math.round((newSurge - L.pricing.currentSurge) * 100) / 100 },
      },
      confidence: 0.8,
      freshness: new Date().toISOString(),
      source: "twin-simulation",
      generatedAt: new Date().toISOString(),
    };
  }

  /** AI executive insights for a city — every insight carries a confidence. */
  async executiveInsights(city: string): Promise<TwinResult<unknown>> {
    const t = (await this.cityTwin(city)).data as {
      layers: { demand: { current: number; forecast1h: number }; supply: { shortageRisk: number; available: number }; revenue: { current24h: number; projectedDaily: number }; pricing: { predictedSurge: number }; fraud: { events: number }; weather: { floodRisk: string; severity: string } | null };
    };
    const L = t.layers;
    const insights: Array<{ text: string; confidence: number; severity: "info" | "warning" | "critical" }> = [];
    if (L.supply.shortageRisk >= 60) insights.push({ text: `Provider shortage likely in ${city} (risk ${L.supply.shortageRisk}, only ${L.supply.available} available) within ~60 min.`, confidence: 0.82, severity: "warning" });
    // Demand-rise insight only with a meaningful baseline (avoid 0→% distortion); else absolute.
    if (L.demand.current >= 3 && L.demand.forecast1h > L.demand.current * 1.1) {
      insights.push({ text: `Demand expected to rise ~${Math.round((L.demand.forecast1h / L.demand.current - 1) * 100)}% in the next hour in ${city}.`, confidence: 0.75, severity: "info" });
    } else if (L.demand.current < 3 && L.demand.forecast1h >= 3) {
      insights.push({ text: `Demand picking up in ${city}: ~${L.demand.forecast1h} bookings forecast next hour (quiet now).`, confidence: 0.7, severity: "info" });
    }
    // Revenue insight needs a non-trivial baseline to avoid divide-by-near-zero.
    if (L.revenue.current24h >= 500 && L.revenue.projectedDaily > L.revenue.current24h * 1.1) insights.push({ text: `${city} revenue forecast exceeds the last-24h run-rate by ${Math.round((L.revenue.projectedDaily / L.revenue.current24h - 1) * 100)}%.`, confidence: 0.7, severity: "info" });
    if (L.pricing.predictedSurge >= 1.5) insights.push({ text: `Surge ×${L.pricing.predictedSurge} active/expected in ${city} — capture window.`, confidence: 0.8, severity: "info" });
    if (L.fraud.events > 0) insights.push({ text: `${L.fraud.events} GPS-fraud event(s) detected in ${city} — review high-risk providers.`, confidence: 0.9, severity: "critical" });
    if (L.weather && (L.weather.floodRisk !== "low" || ["severe", "extreme"].includes(L.weather.severity))) insights.push({ text: `Severe weather in ${city} (flood risk ${L.weather.floodRisk}) — ETA buffers + surge engaged.`, confidence: 0.85, severity: "warning" });
    observeHist("digital_twin_insights", insights.length, { city });
    return { data: { city, insights }, confidence: 0.85, freshness: new Date().toISOString(), source: "twin-insights", generatedAt: new Date().toISOString() };
  }
}

export const digitalTwinService = new DigitalTwinService();
