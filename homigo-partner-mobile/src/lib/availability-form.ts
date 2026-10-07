/**
 * The availability form: what the server has, what the partner typed, and what may be saved.
 *
 * THE RULE: a field the server sent as null is an EMPTY field. Nothing is prefilled with a made-up
 * default (the old screen showed 09:00–18:00, 5 jobs, 5 km and then saved them as the partner's own
 * settings), and only what the partner actually entered or changed is sent.
 *
 * Server rules mirrored here (apps/backend partner-operations.service `updateAvailabilityConfig`,
 * schemas/provider.schema `providerServiceAreaSchema`):
 *  - hours are HH:MM, start before end. If only ONE of start / end is sent the server fills the
 *    other with its own 09:00 / 18:00 — so the two are only ever sent together;
 *  - at least one working day when days are sent;
 *  - break windows are HH:MM pairs, start before end; the list sent REPLACES the stored one, and
 *    an empty list clears them — the form edits the first window and resends the rest unchanged;
 *  - max jobs per day 1–50, or null for "no daily limit"; max jobs at once 1–20;
 *  - radius 1–50 km; city 1–80 characters; at most 20 areas of 1–80 characters;
 *  - base latitude and longitude are sent together.
 *
 * Pure: no import.
 */
export const WORKING_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const LIMITS = { jobsPerDay: { min: 1, max: 50 }, jobsAtOnce: { min: 1, max: 20 }, radiusKm: { min: 1, max: 50 }, areas: 20, areaLength: 80 } as const;

export type AvailabilityServer = {
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  breakWindows: Array<{ start: string; end: string }>;
  maxJobsPerDay: number | null;
  /** The STORED value. Null when the caller cannot tell stored from normalised. */
  maxConcurrentJobs: number | null;
  serviceRadiusKm: number | null;
  serviceRegions: string[];
  city: string | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
};

export type AvailabilityForm = {
  days: string[];
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
  maxDay: string;
  maxAtOnce: string;
  radius: string;
  areas: string;
  city: string;
  lat: number | null;
  lng: number | null;
};

export type AvailabilityField = "days" | "hours" | "break" | "maxDay" | "maxAtOnce" | "radius" | "areas" | "city";

const text = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** The form as the server's values, with empty strings where the server sent nothing. */
export function formFromServer(s: AvailabilityServer): AvailabilityForm {
  return {
    days: [...s.workingDays],
    start: s.workingHoursStart ?? "",
    end: s.workingHoursEnd ?? "",
    breakStart: s.breakWindows[0]?.start ?? "",
    breakEnd: s.breakWindows[0]?.end ?? "",
    maxDay: text(s.maxJobsPerDay),
    maxAtOnce: text(s.maxConcurrentJobs),
    radius: text(s.serviceRadiusKm),
    areas: s.serviceRegions.join(", "),
    city: s.city ?? "",
    lat: s.baseLatitude,
    lng: s.baseLongitude,
  };
}

/** How many break windows the server holds beyond the one the form shows. They are never dropped by a save. */
export function otherBreakWindows(s: AvailabilityServer): number {
  return Math.max(0, s.breakWindows.length - 1);
}

/** "9:5" is not a time; "09:05" is. 24-hour, zero-padded — exactly what the server accepts. */
export function isHm(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

function wholeNumber(raw: string): number | null {
  const t = raw.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

export function parseAreas(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

export type SettingsPatch = {
  workingDays?: string[];
  workingHoursStart?: string;
  workingHoursEnd?: string;
  breakWindows?: Array<{ start: string; end: string }>;
  maxJobsPerDay?: number | null;
  maxConcurrentJobs?: number;
};

export type ServiceAreaPatch = {
  city?: string;
  serviceRegions?: string[];
  serviceRadiusKm?: number;
  baseLatitude?: number;
  baseLongitude?: number;
};

export type AvailabilityPatch = {
  /** Null when nothing in that group changed: the request is then not made at all. */
  settings: SettingsPatch | null;
  serviceArea: ServiceAreaPatch | null;
  errors: Partial<Record<AvailabilityField, string>>;
  /** Nothing to save and nothing wrong. */
  unchanged: boolean;
};

/**
 * What to send. A group with an error sends nothing; an untouched field is never sent; an emptied
 * field is sent only where the server has a way to clear it (max jobs per day → null, break → []).
 */
export function buildAvailabilityPatch(form: AvailabilityForm, server: AvailabilityServer): AvailabilityPatch {
  const errors: AvailabilityPatch["errors"] = {};
  const settings: SettingsPatch = {};
  const area: ServiceAreaPatch = {};
  const before = formFromServer(server);

  if (!sameList(form.days, before.days)) {
    if (form.days.length === 0) errors.days = "Choose at least one working day.";
    else settings.workingDays = WORKING_DAYS.filter((d) => form.days.includes(d));
  }

  const start = form.start.trim();
  const end = form.end.trim();
  if (start !== before.start || end !== before.end) {
    if (!start || !end) errors.hours = "Enter both a start and an end time, or leave both as they were.";
    else if (!isHm(start) || !isHm(end)) errors.hours = "Use 24-hour times like 09:00 and 18:30.";
    else if (start >= end) errors.hours = "The start time must be before the end time.";
    else {
      settings.workingHoursStart = start;
      settings.workingHoursEnd = end;
    }
  }

  const bs = form.breakStart.trim();
  const be = form.breakEnd.trim();
  if (bs !== before.breakStart || be !== before.breakEnd) {
    // The form shows the FIRST window only, and the server replaces the whole list with what is
    // sent — so the windows the form never showed go back exactly as they came.
    const untouched = server.breakWindows.slice(1).map((w) => ({ start: w.start, end: w.end }));
    if (!bs && !be) settings.breakWindows = untouched;
    else if (!bs || !be) errors.break = "Enter both break times, or clear both for no break.";
    else if (!isHm(bs) || !isHm(be)) errors.break = "Use 24-hour times like 13:00 and 14:00.";
    else if (bs >= be) errors.break = "The break must start before it ends.";
    else settings.breakWindows = [{ start: bs, end: be }, ...untouched];
  }

  if (form.maxDay.trim() !== before.maxDay) {
    const raw = form.maxDay.trim();
    const n = wholeNumber(raw);
    if (!raw) settings.maxJobsPerDay = null;
    else if (n == null || n < LIMITS.jobsPerDay.min || n > LIMITS.jobsPerDay.max) errors.maxDay = `Enter a whole number from ${LIMITS.jobsPerDay.min} to ${LIMITS.jobsPerDay.max}, or leave it empty for no daily limit.`;
    else settings.maxJobsPerDay = n;
  }

  if (form.maxAtOnce.trim() !== before.maxAtOnce) {
    const raw = form.maxAtOnce.trim();
    const n = wholeNumber(raw);
    if (!raw) errors.maxAtOnce = "This limit cannot be cleared. Enter a number or leave it as it was.";
    else if (n == null || n < LIMITS.jobsAtOnce.min || n > LIMITS.jobsAtOnce.max) errors.maxAtOnce = `Enter a whole number from ${LIMITS.jobsAtOnce.min} to ${LIMITS.jobsAtOnce.max}.`;
    else settings.maxConcurrentJobs = n;
  }

  if (form.radius.trim() !== before.radius) {
    const raw = form.radius.trim();
    const n = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
    if (!raw) errors.radius = "A radius cannot be cleared. Enter a distance or leave it as it was.";
    else if (n == null || n < LIMITS.radiusKm.min || n > LIMITS.radiusKm.max) errors.radius = `Enter a distance from ${LIMITS.radiusKm.min} to ${LIMITS.radiusKm.max} km.`;
    else area.serviceRadiusKm = n;
  }

  const areas = parseAreas(form.areas);
  if (!sameList(areas, server.serviceRegions)) {
    if (areas.length > LIMITS.areas) errors.areas = `At most ${LIMITS.areas} areas.`;
    else if (areas.some((a) => a.length > LIMITS.areaLength)) errors.areas = `Each area can be at most ${LIMITS.areaLength} characters.`;
    else area.serviceRegions = areas;
  }

  const city = form.city.trim();
  if (city !== before.city) {
    if (!city) errors.city = "A city cannot be cleared. Enter one or leave it as it was.";
    else if (city.length > 80) errors.city = "A city name can be at most 80 characters.";
    else area.city = city;
  }

  if (form.lat != null && form.lng != null && (form.lat !== server.baseLatitude || form.lng !== server.baseLongitude)) {
    area.baseLatitude = form.lat;
    area.baseLongitude = form.lng;
  }

  const settingsError = Boolean(errors.days || errors.hours || errors.break || errors.maxDay || errors.maxAtOnce);
  const areaError = Boolean(errors.radius || errors.areas || errors.city);
  const hasSettings = Object.keys(settings).length > 0 && !settingsError;
  const hasArea = Object.keys(area).length > 0 && !areaError;
  return {
    settings: hasSettings ? settings : null,
    serviceArea: hasArea ? area : null,
    errors,
    unchanged: !hasSettings && !hasArea && Object.keys(errors).length === 0,
  };
}
