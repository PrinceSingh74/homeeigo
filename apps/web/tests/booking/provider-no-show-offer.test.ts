/**
 * "Professional didn't arrive" (POST /api/bookings/:id/provider-no-show). The server refuses it
 * before the booked time and for 15 minutes after it; the control is offered only once the server
 * would consider it, and a refusal is shown in the server's own words — never "try again".
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canReportProviderNoShow, PROVIDER_NO_SHOW_WAIT_MINUTES } from "@/lib/provider-no-show-offer";

const booked = "2026-10-07T09:00:00.000Z";
const at = (minutesAfter: number) => Date.parse(booked) + minutesAfter * 60_000;

describe("canReportProviderNoShow", () => {
  test("not offered before the booked time, nor during the wait after it", () => {
    expect(canReportProviderNoShow("assigned", booked, at(-60))).toBe(false);
    expect(canReportProviderNoShow("en_route", booked, at(PROVIDER_NO_SHOW_WAIT_MINUTES - 1))).toBe(false);
  });

  test("offered once the wait has passed, while the booking still waits on the professional", () => {
    for (const status of ["accepted", "assigned", "en_route", "EN_ROUTE"]) {
      expect(canReportProviderNoShow(status, booked, at(PROVIDER_NO_SHOW_WAIT_MINUTES))).toBe(true);
    }
  });

  test("never offered once the job has started or ended, or before the booked time is known", () => {
    for (const status of ["pending", "in_progress", "completed", "cancelled", undefined]) {
      expect(canReportProviderNoShow(status, booked, at(120))).toBe(false);
    }
    expect(canReportProviderNoShow("assigned", undefined, at(120))).toBe(false);
  });
});

describe("a refusal is the server's sentence", () => {
  const src = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "src", rel), "utf8");

  test("the mutation shows what the server said, not a generic retry", () => {
    const hook = src("hooks/use-core-data.ts");
    const start = hook.indexOf("export function useReportProviderNoShowMutation");
    const body = hook.slice(start, hook.indexOf("\n}\n", start));
    expect(body.includes("Could not report this. Please try again.")).toBe(false);
    expect(body.includes("getErrorMessage(")).toBe(true);
  });

  test("the modal passes the booked time to the rule and does not leave a refusal unhandled", () => {
    const modal = src("components/booking/BookingDetailModal.tsx");
    expect(/canReportProviderNoShow\(liveStatus,\s*[^)]+\)/.test(modal)).toBe(true);
    expect(modal.includes("reportNoShow.mutateAsync(booking.id).then(() => onClose())")).toBe(false);
  });
});
