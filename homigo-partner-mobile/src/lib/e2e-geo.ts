/**
 * Emulator e2e GPS harness. When the AVD's Location APIs do not deliver
 * `adb emu geo fix` (common on Windows API 36 images), the native driver
 * passes coordinates via the job deep link. The booking geofence still
 * validates them — wrong / outside / null-island coords are rejected.
 */
export type E2eGeo = { latitude: number; longitude: number };

let override: E2eGeo | null = null;

import { rememberJobFix } from "@/lib/job-fix-cache";

export function setE2eGeoOverride(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (lat === 0 && lng === 0) return;
  override = { latitude: lat, longitude: lng };
  rememberJobFix(lat, lng);
}

export function clearE2eGeoOverride() {
  override = null;
}

export function getE2eGeoOverride(): E2eGeo | null {
  return override;
}
