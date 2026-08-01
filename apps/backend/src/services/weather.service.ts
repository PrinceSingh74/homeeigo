/**
 * Weather intelligence (OpenWeather) — powers dynamic surge pricing, ETA
 * adjustment, vendor-availability impact, and customer/partner weather warnings.
 *
 * Fail-safe by design (mirrors maps/sentry): when WEATHER_API_KEY is missing or the
 * upstream is unavailable, every method returns null and callers fall back to their
 * normal (weather-neutral) behaviour — never fake data. Results are cached in Redis
 * (cacheService) and the upstream call is wrapped in a circuit breaker.
 *
 * Key is read ONLY from process.env.WEATHER_API_KEY.
 */
import { cacheService } from "./cache.service";
import { weatherBreaker, CircuitOpenError } from "../lib/circuit-breaker";
import { incCounter, setGauge } from "../lib/metrics";
import { logger } from "../lib/logger";

const KEY = process.env.WEATHER_API_KEY || "";
const BASE = "https://api.openweathermap.org/data/2.5";
const TIMEOUT_MS = 8_000;
const CACHE_TTL = { current: 600, forecast: 1_800 } as const; // 10m current, 30m forecast

export type WeatherSeverity = "clear" | "mild" | "moderate" | "severe" | "extreme";

export interface WeatherSnapshot {
  city: string | null;
  lat: number;
  lng: number;
  tempC: number;
  feelsLikeC: number;
  humidity: number; // %
  windSpeedKmh: number;
  rain1hMm: number; // precip last 1h
  conditionCode: number; // OpenWeather condition id
  condition: string; // e.g. "Rain", "Thunderstorm"
  description: string; // e.g. "heavy intensity rain"
  severity: WeatherSeverity;
  isRaining: boolean;
  isStorm: boolean;
  observedAt: string; // ISO
}

export interface WeatherAlert {
  type: "rain" | "storm" | "wind" | "heat" | "extreme";
  level: "advisory" | "warning" | "severe";
  message: string;
}

/** Map OpenWeather condition id → severity. https://openweathermap.org/weather-conditions */
function severityFor(code: number, windKmh: number, rainMm: number, tempC: number): WeatherSeverity {
  if (code >= 200 && code < 233) return code >= 211 ? "extreme" : "severe"; // thunderstorm
  if (code >= 502 && code <= 531) return "severe"; // heavy/very-heavy/extreme rain
  if (code >= 500 && code <= 501) return "moderate"; // light/moderate rain
  if (code >= 600 && code <= 622) return "severe"; // snow
  if (code >= 762 && code <= 781) return "extreme"; // ash/squall/tornado
  if (code >= 701 && code <= 741) return "moderate"; // mist/fog/haze
  if (windKmh >= 60 || rainMm >= 10) return "severe";
  if (windKmh >= 35 || rainMm >= 2.5) return "moderate";
  if (tempC >= 45 || tempC <= 2) return "moderate";
  if (windKmh >= 20) return "mild";
  return "clear";
}

type OWCurrent = {
  coord?: { lat: number; lon: number };
  weather?: Array<{ id: number; main: string; description: string }>;
  main?: { temp: number; feels_like: number; humidity: number };
  wind?: { speed: number };
  rain?: { "1h"?: number };
  name?: string;
  dt?: number;
  cod?: number;
};

class WeatherService {
  get isConfigured(): boolean {
    return KEY.length > 0;
  }

  private async owFetch<T>(path: string, params: Record<string, string>): Promise<T | null> {
    if (!KEY) return null;
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("appid", KEY);
    url.searchParams.set("units", "metric");
    incCounter("weather_api_calls_total", { path: path.replace(/^\//, "") });
    try {
      return await weatherBreaker.execute(async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) {
          incCounter("weather_api_failures_total", { reason: `http_${res.status}` });
          // 401 = key not yet active/invalid; treat as upstream failure (breaker counts it).
          throw new Error(`openweather_http_${res.status}`);
        }
        return (await res.json()) as T;
      });
    } catch (e) {
      if (e instanceof CircuitOpenError) {
        incCounter("weather_api_failures_total", { reason: "circuit_open" });
      } else {
        incCounter("weather_api_failures_total", { reason: "fetch_failed" });
        logger.warn("weather.fetch_failed", { path, error: e instanceof Error ? e.message : String(e) });
      }
      return null;
    }
  }

  private normalize(d: OWCurrent, fallbackLat: number, fallbackLng: number): WeatherSnapshot | null {
    if (!d || !d.main || !d.weather?.length) return null;
    const w = d.weather[0]!;
    const windKmh = Math.round(((d.wind?.speed ?? 0) * 3.6) * 10) / 10;
    const rainMm = d.rain?.["1h"] ?? 0;
    const tempC = Math.round((d.main.temp ?? 0) * 10) / 10;
    const severity = severityFor(w.id, windKmh, rainMm, tempC);
    return {
      city: d.name ?? null,
      lat: d.coord?.lat ?? fallbackLat,
      lng: d.coord?.lon ?? fallbackLng,
      tempC,
      feelsLikeC: Math.round((d.main.feels_like ?? tempC) * 10) / 10,
      humidity: d.main.humidity ?? 0,
      windSpeedKmh: windKmh,
      rain1hMm: rainMm,
      conditionCode: w.id,
      condition: w.main,
      description: w.description,
      severity,
      isRaining: w.id >= 200 && w.id < 600,
      isStorm: w.id >= 200 && w.id < 233,
      observedAt: new Date((d.dt ?? Date.now() / 1000) * 1000).toISOString(),
    };
  }

  /** Live current weather by coordinates (Redis-cached 10m). null when unconfigured/unavailable. */
  async getByCoords(lat: number, lng: number): Promise<WeatherSnapshot | null> {
    if (!KEY) return null;
    const key = `weather:cur:${lat.toFixed(2)}:${lng.toFixed(2)}`;
    const snap = await cacheService.getOrFetch<WeatherSnapshot | null>(key, CACHE_TTL.current, async () => {
      const d = await this.owFetch<OWCurrent>("/weather", { lat: String(lat), lon: String(lng) });
      return d ? this.normalize(d, lat, lng) : null;
    });
    if (snap) this.publishMetrics(snap);
    return snap;
  }

  /** Live current weather by city name (e.g. "Mumbai,IN"). */
  async getByCity(city: string): Promise<WeatherSnapshot | null> {
    if (!KEY) return null;
    const key = `weather:cur:city:${city.toLowerCase()}`;
    const snap = await cacheService.getOrFetch<WeatherSnapshot | null>(key, CACHE_TTL.current, async () => {
      const d = await this.owFetch<OWCurrent>("/weather", { q: city });
      return d ? this.normalize(d, d.coord?.lat ?? 0, d.coord?.lon ?? 0) : null;
    });
    if (snap) this.publishMetrics(snap);
    return snap;
  }

  /** Short-range forecast (next N 3-hour steps). */
  async getForecast(lat: number, lng: number, steps = 8): Promise<WeatherSnapshot[] | null> {
    if (!KEY) return null;
    const key = `weather:fc:${lat.toFixed(2)}:${lng.toFixed(2)}:${steps}`;
    return cacheService.getOrFetch<WeatherSnapshot[] | null>(key, CACHE_TTL.forecast, async () => {
      const d = await this.owFetch<{ list?: OWCurrent[] }>("/forecast", {
        lat: String(lat),
        lon: String(lng),
        cnt: String(steps),
      });
      if (!d?.list?.length) return null;
      return d.list.map((s) => this.normalize(s, lat, lng)).filter((s): s is WeatherSnapshot => s !== null);
    });
  }

  /** Derive customer/partner-facing alerts from a snapshot. */
  alertsFor(snap: WeatherSnapshot): WeatherAlert[] {
    const alerts: WeatherAlert[] = [];
    if (snap.isStorm) {
      alerts.push({ type: "storm", level: "severe", message: `Thunderstorm in ${snap.city ?? "your area"} — service may be delayed or rescheduled for safety.` });
    } else if (snap.isRaining && snap.severity === "severe") {
      alerts.push({ type: "rain", level: "warning", message: `Heavy rain (${snap.rain1hMm}mm/h) — expect delays and possible rescheduling.` });
    } else if (snap.isRaining) {
      alerts.push({ type: "rain", level: "advisory", message: `Rain in ${snap.city ?? "your area"} — partner ETA may be longer.` });
    }
    if (snap.windSpeedKmh >= 50) {
      alerts.push({ type: "wind", level: snap.windSpeedKmh >= 70 ? "severe" : "warning", message: `High winds (${snap.windSpeedKmh} km/h) may affect outdoor services.` });
    }
    if (snap.tempC >= 45) {
      alerts.push({ type: "heat", level: "warning", message: `Extreme heat (${snap.tempC}°C) — outdoor work slowed for partner safety.` });
    }
    if (snap.severity === "extreme") {
      alerts.push({ type: "extreme", level: "severe", message: `Extreme weather alert — non-essential bookings may be paused.` });
    }
    if (alerts.length) incCounter("weather_alerts_total", { severity: snap.severity });
    return alerts;
  }

  /** Weather surge multiplier (1.0–1.5) applied on top of geofence surge. */
  surgeMultiplier(snap: WeatherSnapshot | null): number {
    if (!snap) return 1;
    const m: Record<WeatherSeverity, number> = { clear: 1, mild: 1, moderate: 1.15, severe: 1.3, extreme: 1.5 };
    const mult = m[snap.severity];
    setGauge("weather_surge_multiplier", mult, { city: snap.city ?? "unknown" });
    return mult;
  }

  /** ETA adjustment factor (1.0–1.4) — bad weather slows partner travel. */
  etaAdjustmentFactor(snap: WeatherSnapshot | null): number {
    if (!snap) return 1;
    const m: Record<WeatherSeverity, number> = { clear: 1, mild: 1.05, moderate: 1.15, severe: 1.3, extreme: 1.4 };
    return m[snap.severity];
  }

  /** Vendor/partner availability impact assessment. */
  vendorAvailabilityImpact(snap: WeatherSnapshot | null): {
    impact: "none" | "reduced" | "severe";
    factor: number; // expected available-capacity multiplier
    reason: string;
  } {
    if (!snap) return { impact: "none", factor: 1, reason: "no weather data" };
    if (snap.severity === "extreme") return { impact: "severe", factor: 0.4, reason: `${snap.description} — many partners unavailable` };
    if (snap.severity === "severe") return { impact: "reduced", factor: 0.7, reason: `${snap.description} — reduced partner availability` };
    if (snap.severity === "moderate") return { impact: "reduced", factor: 0.85, reason: `${snap.description} — slightly fewer partners` };
    return { impact: "none", factor: 1, reason: "normal conditions" };
  }

  private publishMetrics(snap: WeatherSnapshot): void {
    const labels = { city: snap.city ?? "unknown" };
    setGauge("weather_temperature_celsius", snap.tempC, labels);
    setGauge("weather_humidity_percent", snap.humidity, labels);
    setGauge("weather_wind_speed_kmh", snap.windSpeedKmh, labels);
    setGauge("weather_rain_1h_mm", snap.rain1hMm, labels);
  }
}

export const weatherService = new WeatherService();
