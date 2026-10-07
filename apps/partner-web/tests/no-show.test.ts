import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doorPhotoUploadId, noShowResultView, noShowView, NO_SHOW_REFETCH_FLOOR_MS } from "../src/lib/no-show";
import type { NoShowPreview } from "../src/types/partner";

/**
 * "Customer not available" on the job page. The server decides everything that matters — whether
 * the wait is served, whether the fee applies, and the sentence that says so. What is tested here
 * is the little the page works out for itself: the live countdown between two server answers, and
 * which controls a given answer puts on screen.
 */
const T0 = 1_760_000_000_000;
const MIN = 60_000;

const preview = (over: Partial<NoShowPreview> = {}): NoShowPreview => ({
  canReport: false,
  waitedMinutes: 10,
  graceMinutes: 15,
  minutesLeft: 5,
  feeWillApply: false,
  feePercent: 50,
  reason: "NO_DOOR_PHOTO",
  hasDoorPhoto: false,
  message: "Add a photo at the door, with location on, before you report. Without it the no-show is still recorded but no fee is charged and support reviews it.",
  ...over,
});

describe("the wait, counted down from the server's numbers", () => {
  test("at the moment of the answer it shows the server's minutes", () => {
    const v = noShowView(preview(), T0, T0);
    expect(v.waitLabel).toBe("You can report in 5 min");
    expect(v.minutesLeft).toBe(5);
    expect(v.canReport).toBe(false);
    expect(v.shouldRefetch).toBe(false);
  });

  test("whole minutes come off as they pass; a part minute does not", () => {
    expect(noShowView(preview(), T0, T0 + 59_000).minutesLeft).toBe(5);
    expect(noShowView(preview(), T0, T0 + 2 * MIN + 1).minutesLeft).toBe(3);
    expect(noShowView(preview(), T0, T0 + 2 * MIN + 1).waitLabel).toBe("You can report in 3 min");
  });

  test("at zero it asks the server again instead of enabling the button on the local clock", () => {
    const v = noShowView(preview(), T0, T0 + 5 * MIN);
    expect(v.minutesLeft).toBe(0);
    expect(v.canReport).toBe(false);
    expect(v.shouldRefetch).toBe(true);
    expect(v.waitLabel).toBe("Checking the wait…");
  });

  test("it never counts below zero, and a clock that ran backwards does not add minutes", () => {
    expect(noShowView(preview(), T0, T0 + 90 * MIN).minutesLeft).toBe(0);
    expect(noShowView(preview(), T0, T0 - 10 * MIN).minutesLeft).toBe(5);
  });

  test("an answer that just arrived is not asked for again straight away (no refetch loop)", () => {
    const fresh = preview({ minutesLeft: 0, waitedMinutes: 15 });
    expect(noShowView(fresh, T0, T0 + NO_SHOW_REFETCH_FLOOR_MS - 1).shouldRefetch).toBe(false);
    expect(noShowView(fresh, T0, T0 + NO_SHOW_REFETCH_FLOOR_MS).shouldRefetch).toBe(true);
  });

  test("once the server says it can be reported, it can — whatever the local clock says", () => {
    const v = noShowView(preview({ canReport: true, waitedMinutes: 16, minutesLeft: 0 }), T0, T0 - 60 * MIN);
    expect(v.canReport).toBe(true);
    expect(v.waitLabel).toBe("You can report now");
    expect(v.shouldRefetch).toBe(false);
  });

  test("a wait the server could not measure stays closed and is not polled", () => {
    const v = noShowView(preview({ waitedMinutes: null, minutesLeft: null }), T0, T0 + 30 * MIN);
    expect(v.canReport).toBe(false);
    expect(v.minutesLeft).toBeNull();
    expect(v.shouldRefetch).toBe(false);
    expect(v.waitLabel).toBe("Not available yet");
  });
});

describe("the door photo control follows the server's answer", () => {
  test("no door photo on record: the photo is asked for", () => {
    expect(noShowView(preview(), T0, T0).doorPhoto).toBe("NEEDED");
  });

  test("a door photo on record: it says so and stops asking", () => {
    expect(noShowView(preview({ hasDoorPhoto: true, feeWillApply: true, reason: null }), T0, T0).doorPhoto).toBe("ADDED");
  });

  test("a vouched arrival: a photo would change nothing, so none is asked for", () => {
    expect(noShowView(preview({ reason: "ARRIVAL_VOUCHED", hasDoorPhoto: false }), T0, T0).doorPhoto).toBe("NOT_ASKED");
    expect(noShowView(preview({ reason: "ARRIVAL_VOUCHED", hasDoorPhoto: true }), T0, T0).doorPhoto).toBe("ADDED");
  });

  test("the sentence shown is the server's, untouched", () => {
    const p = preview({ message: "Server sentence." });
    expect(noShowView(p, T0, T0).message).toBe("Server sentence.");
  });

  test("each photo gets its own upload id, so a retry of another photo is not refused as a duplicate", () => {
    expect(doorPhotoUploadId(T0)).toBe(`web-door-${T0}`);
    expect(doorPhotoUploadId(T0 + 1)).not.toBe(doorPhotoUploadId(T0));
  });
});

describe("the result shown after reporting is what the server answered", () => {
  test("no fee taken: the server's message and its note", () => {
    expect(noShowResultView({ message: "No-show recorded", status: "customer_no_show", feeAmount: 0, feeWithheld: "NO_DOOR_PHOTO", feeNote: "No fee was taken: add a photo next time." })).toEqual({
      message: "No-show recorded",
      feeNote: "No fee was taken: add a photo next time.",
      feeRecorded: null,
    });
  });

  test("fee taken: the amount the server disclosed, and no note", () => {
    expect(noShowResultView({ message: "No-show recorded", status: "customer_no_show", feeAmount: 275 })).toEqual({ message: "No-show recorded", feeNote: null, feeRecorded: 275 });
  });
});

/* ------------------------------------------------------------------ */
/* Wiring — read from the source, like the other page tests here.      */
/* ------------------------------------------------------------------ */
const root = join(import.meta.dir, "..", "src");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const section = read("components", "requests", "NoShowSection.tsx");
const page = read("app", "(partner)", "requests", "[id]", "page.tsx");
const hooks = read("hooks", "use-partner-data.ts");
const api = read("services", "partner-api.ts");
const types = read("types", "partner.ts");

describe("the section on the job page", () => {
  test("the job page renders it from the server's actions answer", () => {
    expect(page).toContain("<NoShowSection");
    expect(page).toContain("actionsQuery.data?.noShow");
  });

  test("it carries the test ids the browser harness looks for", () => {
    for (const id of ["no-show-section", "no-show-message", "no-show-door-photo", "no-show-report", "no-show-result"]) {
      expect({ id, present: section.includes(`data-testid="${id}"`) }).toEqual({ id, present: true });
    }
  });

  test("it is collapsed until asked for, and says so to assistive technology", () => {
    expect(section).toContain("useState(false)");
    expect(section).toContain("aria-expanded={open}");
    expect(section).toContain("aria-controls=");
  });

  test("the door photo is taken with the camera and uploaded as ARRIVAL evidence read from the file", () => {
    expect(section).toContain('accept="image/*"');
    expect(section).toContain('capture="environment"');
    expect(section).toContain('stage: "ARRIVAL"');
    expect(section).toContain("fileToDataUrl(file)");
    // The position on the row is the server's: the page sends none.
    expect(section).not.toMatch(/latitude|longitude/);
  });

  test("results and refusals are announced, and the confirm dialog is a labelled modal", () => {
    expect(section).toContain('role="status"');
    expect(section).toContain('role="alert"');
    expect(section).toContain('role="dialog"');
    expect(section).toContain('aria-modal="true"');
    expect(section).toContain("aria-labelledby=");
    expect(section).toContain("aria-describedby=");
  });

  test("it writes no sentence of its own about fees or eligibility", () => {
    const withoutComments = section.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(withoutComments).not.toMatch(/\bfee (applies|is charged|will)|no fee|50%|15 min|refund/i);
  });
});

describe("reporting refreshes the job", () => {
  const start = hooks.indexOf("export function useReportNoShowMutation(");
  const body = start < 0 ? "" : hooks.slice(start, hooks.indexOf("\nexport function ", start + 1));

  test("the mutation exists and posts to the no-show route", () => {
    expect(start).toBeGreaterThan(-1);
    expect(api).toContain("/api/bookings/${bookingId}/no-show");
  });

  test("it invalidates the bookings, the job actions and the open job's own read", () => {
    expect(body).toContain("partnerKeys.bookingsAll");
    expect(body).toContain("partnerKeys.jobActionsAll");
    expect(body).toContain("bookingDetailKey(");
  });
});

describe("the frontend type mirrors the backend's preview, field for field", () => {
  const fieldsOf = (source: string, name: string): string[] => {
    const at = source.indexOf(`export type ${name} = {`);
    if (at < 0) throw new Error(`${name} not found`);
    const block = source.slice(at, source.indexOf("\n};", at));
    return [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]).sort();
  };

  test("NoShowPreview has exactly the backend's fields", () => {
    const backend = readFileSync(join(import.meta.dir, "..", "..", "backend", "src", "services", "booking-no-show.service.ts"), "utf8");
    const theirs = fieldsOf(backend, "NoShowPreview");
    expect(theirs.length).toBe(9);
    expect(fieldsOf(types, "NoShowPreview")).toEqual(theirs);
  });

  test("the actions answer carries it as `noShow`, as the route sends it", () => {
    const route = readFileSync(join(import.meta.dir, "..", "..", "backend", "src", "routes", "bookings.ts"), "utf8");
    expect(route).toContain("...(noShow ? { noShow } : {})");
    expect(types).toMatch(/noShow\?: NoShowPreview/);
  });
});
