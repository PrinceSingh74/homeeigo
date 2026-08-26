/**
 * Canonical partner capacity math. Dispatch, matching, and the partner API
 * must all use these helpers — never a second counter.
 */

export const DEFAULT_MAX_CONCURRENT_JOBS = 4;
export const MIN_CONCURRENT_JOBS = 1;
export const MAX_CONCURRENT_JOBS = 20;
export const MIN_JOBS_PER_DAY = 1;
export const MAX_JOBS_PER_DAY = 50;
export const MIN_SERVICE_RADIUS_KM = 1;
export const MAX_SERVICE_RADIUS_KM = 50;

export type CapacityCounts = {
  currentJobs: number;
  reservedOffers: number;
  jobsToday: number;
  maxConcurrentJobs: number;
  maxJobsPerDay: number | null;
};

export type CapacitySnapshot = CapacityCounts & {
  availableSlots: number;
  utilization: number;
  capacityFull: boolean;
};

export function normalizeMaxConcurrent(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_CONCURRENT_JOBS;
  return Math.min(MAX_CONCURRENT_JOBS, Math.max(MIN_CONCURRENT_JOBS, Math.trunc(n)));
}

export function normalizeMaxJobsPerDay(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_JOBS_PER_DAY, Math.max(MIN_JOBS_PER_DAY, Math.trunc(n)));
}

export function computeCapacity(counts: CapacityCounts): CapacitySnapshot {
  const maxConcurrent = normalizeMaxConcurrent(counts.maxConcurrentJobs);
  const maxPerDay = normalizeMaxJobsPerDay(counts.maxJobsPerDay);
  const currentJobs = Math.max(0, Math.trunc(counts.currentJobs));
  const reservedOffers = Math.max(0, Math.trunc(counts.reservedOffers));
  const jobsToday = Math.max(0, Math.trunc(counts.jobsToday));

  const concurrentUsed = currentJobs + reservedOffers;
  const concurrentSlots = Math.max(0, maxConcurrent - concurrentUsed);
  const dailySlots = maxPerDay == null ? concurrentSlots : Math.max(0, maxPerDay - jobsToday);
  const availableSlots = Math.min(concurrentSlots, dailySlots);
  const utilization =
    maxConcurrent <= 0 ? 0 : Math.min(100, Math.round((currentJobs / maxConcurrent) * 100));

  return {
    currentJobs,
    reservedOffers,
    jobsToday,
    maxConcurrentJobs: maxConcurrent,
    maxJobsPerDay: maxPerDay,
    availableSlots,
    utilization,
    capacityFull: availableSlots <= 0,
  };
}
