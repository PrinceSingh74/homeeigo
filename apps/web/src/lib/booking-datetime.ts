/** Helpers for free-form booking date & time (local browser timezone). */

export function defaultScheduledSlot(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  return d;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/** e.g. Wed, 22 May */
export function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** e.g. 11:00 AM */
export function formatTimeLabel(d: Date): string {
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseDatetimeLocal(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const h = Number(m[4]);
  const min = Number(m[5]);
  if (
    Number.isNaN(y) ||
    Number.isNaN(mo) ||
    Number.isNaN(day) ||
    Number.isNaN(h) ||
    Number.isNaN(min)
  )
    return null;
  const d = new Date(y, mo, day, h, min, 0, 0);
  if (
    d.getFullYear() !== y ||
    d.getMonth() !== mo ||
    d.getDate() !== day ||
    d.getHours() !== h ||
    d.getMinutes() !== min
  )
    return null;
  return d;
}

export function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toHm24Local(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseYmdLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return d;
}

export function applyDatePart(base: Date, picked: Date): Date {
  const x = new Date(base);
  x.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return x;
}

export function applyTimePart(base: Date, picked: Date): Date {
  const x = new Date(base);
  x.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return x;
}

export function parseHm24OnDate(hm: string, day: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min) || h > 23 || min > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min, 0, 0);
}

export function parse12hTime(s: string): { h: number; m: number } | null {
  const t = s.trim().toUpperCase().replace(/\s+/g, " ");
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3];
  if (min > 59 || h < 1 || h > 12) return null;
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { h, m: min };
}

export function apply12hTimeOnDate(day: Date, timeStr: string): Date | null {
  const parsed = parse12hTime(timeStr);
  if (!parsed) return null;
  const d = new Date(day);
  d.setHours(parsed.h, parsed.m, 0, 0);
  return d;
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function quickNextDays(count: number): Date[] {
  const arr: Date[] = [];
  const today = startOfDay(new Date());
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    arr.push(d);
  }
  return arr;
}

export function quickDayTitle(d: Date): string {
  const today = startOfDay(new Date());
  const dd = startOfDay(d);
  if (dd.getTime() === today.getTime()) return "Today";
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}

export function quickDaySubtitle(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
