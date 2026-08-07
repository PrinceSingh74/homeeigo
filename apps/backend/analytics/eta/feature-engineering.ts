/**
 * Phase 2 — automatic feature engineering for ETA training labels.
 * No ML inference — deterministic derived features only.
 */
import { distanceKm } from "../../src/lib/geo";

export type FeatureEngineeringInput = {
  dispatchTimestamp: Date | null;
  arrivalTimestamp: Date | null;
  partnerLatDispatch: number | null;
  partnerLngDispatch: number | null;
  partnerLatArrival: number | null;
  partnerLngArrival: number | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  travelDistanceMeters: number | null;
  actualTravelDurationSec: number | null;
  googleEtaSeconds: number | null;
  rain: number | null;
  temperature: number | null;
  historicalRouteCount: number | null;
  historicalAvgDuration: number | null;
};

export type EngineeredFeatures = {
  bearing: number | null;
  routeEfficiency: number | null;
  averageSpeed: number | null;
  peakHour: boolean;
  nightFlag: boolean;
  rushHour: boolean;
  distanceBucket: string | null;
  tripBucket: string | null;
  partnerFamiliarity: number | null;
  historicalAvgDelay: number | null;
  weatherBucket: string | null;
};

export function engineerEtaFeatures(input: FeatureEngineeringInput): EngineeredFeatures {
  const ref = input.arrivalTimestamp ?? input.dispatchTimestamp ?? new Date();
  const hour = ref.getHours();
  const isWeekend = ref.getDay() === 0 || ref.getDay() === 6;

  const bearing = computeBearing(
    input.partnerLatDispatch,
    input.partnerLngDispatch,
    input.pickupLatitude,
    input.pickupLongitude,
  );

  const straightLineM =
    input.partnerLatDispatch != null &&
    input.partnerLngDispatch != null &&
    input.pickupLatitude != null &&
    input.pickupLongitude != null
      ? distanceKm(input.partnerLatDispatch, input.partnerLngDispatch, input.pickupLatitude, input.pickupLongitude) * 1000
      : null;

  const routeEfficiency =
    straightLineM != null && input.travelDistanceMeters != null && input.travelDistanceMeters > 0
      ? Math.round((straightLineM / input.travelDistanceMeters) * 1000) / 1000
      : null;

  const averageSpeed =
    input.actualTravelDurationSec != null && input.actualTravelDurationSec > 0 && input.travelDistanceMeters != null
      ? Math.round((input.travelDistanceMeters / input.actualTravelDurationSec) * 3.6 * 10) / 10
      : null;

  const distKm = input.travelDistanceMeters != null ? input.travelDistanceMeters / 1000 : null;
  const durationMin = input.actualTravelDurationSec != null ? input.actualTravelDurationSec / 60 : null;

  const historicalAvgDelay =
    input.historicalAvgDuration != null && durationMin != null
      ? Math.round((durationMin - input.historicalAvgDuration) * 10) / 10
      : null;

  return {
    bearing,
    routeEfficiency,
    averageSpeed,
    peakHour: !isWeekend && (hour >= 8 && hour <= 10 || hour >= 17 && hour <= 20),
    nightFlag: hour >= 22 || hour < 5,
    rushHour: !isWeekend && (hour >= 8 && hour <= 10 || hour >= 17 && hour <= 19),
    distanceBucket: bucketDistance(distKm),
    tripBucket: bucketDuration(durationMin),
    partnerFamiliarity:
      input.historicalRouteCount != null
        ? Math.min(1, input.historicalRouteCount / 50)
        : null,
    historicalAvgDelay,
    weatherBucket: bucketWeather(input.rain, input.temperature),
  };
}

function computeBearing(lat1: number | null, lng1: number | null, lat2: number | null, lng2: number | null): number | null {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

function bucketDistance(km: number | null): string | null {
  if (km == null) return null;
  if (km < 2) return "short";
  if (km < 8) return "medium";
  if (km < 20) return "long";
  return "very_long";
}

function bucketDuration(min: number | null): string | null {
  if (min == null) return null;
  if (min < 10) return "quick";
  if (min < 25) return "normal";
  if (min < 45) return "extended";
  return "long";
}

function bucketWeather(rain: number | null, temp: number | null): string | null {
  if (rain != null && rain > 5) return "heavy_rain";
  if (rain != null && rain > 0.5) return "rain";
  if (temp != null && temp >= 40) return "extreme_heat";
  if (temp != null && temp <= 5) return "cold";
  return "clear";
}
