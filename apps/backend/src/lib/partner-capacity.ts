/**
 * Canonical partner capacity math. Dispatch, matching, and the partner API
 * must all use these helpers — never a second counter.
 */

/**
 * ── OWNER DECISION #10/#11: concurrency is a WORKLOAD cap, not a simultaneity cap ──
 *
 * `currentJobs` counts every booking in a concurrent status with no time bound, and `reservedOffers`
 * counts every unanswered offer the same way. That reads wrong against the field's name, and the
 * first instinct — and the one taken and then reversed while deciding this — is to scope both to the
 * booking's own time slot so "concurrent" means "at the same time".
 *
 * That is wrong, for a structural reason. `bookings_provider_slot_excl` is an EXCLUDE constraint over
 * (provider_id, slot range) with NO status filter, so the database already makes it impossible for
 * one partner to hold two bookings whose slots overlap. Under a time-scoped reading `currentJobs`
 * could therefore never exceed 1, and a limit whose default is 4 and whose ceiling is 20 would be
 * dead code. Proven rather than argued: seeding two accepted bookings twenty minutes apart for one
 * partner is rejected by the database with 23P01.
 *
 * So true simultaneity is already enforced one layer down, and this limit is the only thing capping
 * how much unfinished work a partner may hold at once — accepted jobs plus offers they have not yet
 * answered. That is a coherent rule, it is the behaviour the platform has always had, and partners
 * can raise it to 20 themselves in settings. It is kept.
 *
 * The name is the part that misleads, and this note is where that is recorded: `maxConcurrentJobs`
 * means "jobs in flight", not "jobs at the same instant".
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
