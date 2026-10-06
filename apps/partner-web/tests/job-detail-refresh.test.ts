import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { BOOKINGS_ALL_KEY, bookingDetailKey, patchBookingsCache, restoreSnapshots } from "../src/lib/booking-cache";

/**
 * Browser journey, 2026-10-06: after the customer's PIN started the job (POST /start → 200, the
 * booking IN_PROGRESS in the database) the partner's job page went on saying "ACCEPTED", its
 * lifecycle rows "Pending" and every service step "Start the job first". The page had been moved to
 * its own read (`["partner","booking",id]`), a key no lifecycle mutation and no realtime frame
 * refreshes; and the step list waited for a realtime frame that a dropped socket never delivers.
 */
const root = join(import.meta.dir, "..", "src");
const page = readFileSync(join(root, "app", "(partner)", "requests", "[id]", "page.tsx"), "utf8");
const hooks = readFileSync(join(root, "hooks", "use-partner-data.ts"), "utf8");

function mutation(name: string): string {
  const start = hooks.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const next = hooks.indexOf("\nexport function ", start + 1);
  return hooks.slice(start, next < 0 ? hooks.length : next);
}

describe("the job page's booking is refreshed with every booking change", () => {
  test("its key sits under the key every booking mutation and realtime frame invalidates", () => {
    expect(bookingDetailKey("b1").slice(0, BOOKINGS_ALL_KEY.length)).toEqual([...BOOKINGS_ALL_KEY]);
  });

  test("the page reads through that key, not a private one", () => {
    expect(page).toContain("bookingDetailKey(id)");
    expect(page).not.toMatch(/queryKey: \["partner", "booking", id\]/);
  });

  test("invalidating the booking lists marks the open job stale too", async () => {
    const qc = new QueryClient();
    qc.setQueryData(bookingDetailKey("b1"), { id: "b1", status: "accepted" });
    await qc.invalidateQueries({ queryKey: BOOKINGS_ALL_KEY, refetchType: "none" });
    expect(qc.getQueryState(bookingDetailKey("b1"))?.isInvalidated).toBe(true);
  });
});

describe("an optimistic status change reaches the open job, and is undone on refusal", () => {
  const seed = () => {
    const qc = new QueryClient();
    qc.setQueryData([...BOOKINGS_ALL_KEY, { status: "active" }], { bookings: [{ id: "b1", status: "accepted" }, { id: "b2", status: "accepted" }], total: 2 });
    qc.setQueryData(bookingDetailKey("b1"), { id: "b1", status: "accepted" });
    qc.setQueryData(bookingDetailKey("b2"), { id: "b2", status: "accepted" });
    return qc;
  };

  test("list rows and the job's own read are patched; another job is untouched", () => {
    const qc = seed();
    patchBookingsCache(qc, "b1", { status: "in_progress" });
    expect(qc.getQueryData<{ status: string }>(bookingDetailKey("b1"))?.status).toBe("in_progress");
    expect(qc.getQueryData<{ status: string }>(bookingDetailKey("b2"))?.status).toBe("accepted");
    expect(qc.getQueryData<{ bookings: Array<{ id: string; status: string }> }>([...BOOKINGS_ALL_KEY, { status: "active" }])?.bookings.map((b) => b.status)).toEqual(["in_progress", "accepted"]);
  });

  test("a refused action restores what was there (a wrong PIN must not leave the job 'in progress')", () => {
    const qc = seed();
    const snapshots = patchBookingsCache(qc, "b1", { status: "in_progress" });
    restoreSnapshots(qc, snapshots);
    expect(qc.getQueryData<{ status: string }>(bookingDetailKey("b1"))?.status).toBe("accepted");
    expect(qc.getQueryData<{ bookings: Array<{ status: string }> }>([...BOOKINGS_ALL_KEY, { status: "active" }])?.bookings[0].status).toBe("accepted");
  });
});

describe("starting and completing refresh the step list themselves", () => {
  // The realtime frame is a signal that may never arrive; the partner's own action must not wait for it.
  for (const name of ["useStartBookingMutation", "useCompleteBookingMutation"]) {
    test(`${name} invalidates the execution, requirement and safety reads`, () => {
      const body = mutation(name);
      for (const key of ["execution", "requirements", "safety"]) expect({ key, refreshed: body.includes(`queryKey: ["partner", "${key}"]`) }).toEqual({ key, refreshed: true });
    });
  }
});
