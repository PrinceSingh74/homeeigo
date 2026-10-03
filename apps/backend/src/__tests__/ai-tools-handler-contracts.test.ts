/**
 * P3-8 Investigation A — regression guard for three REAL defects found in the AI-tools WRITE
 * handlers via typecheck, all on state-mutating paths.
 *
 * These handlers are genuinely bound in production (only the 14 HIGH_RISK tools terminate at
 * NO_HANDLER), so each defect was reachable:
 *
 *  1. `write.booking.cancelBooking` called `bookingService.cancel(actor.actorId, ...)` — passing a
 *     BARE STRING where the signature takes an actor OBJECT `{ userId, providerId? }`, so
 *     `actor.userId` was `undefined` inside the service. It also passed a 4th `"CUSTOMER"`
 *     argument the signature does not declare.
 *  2. `write.partner.acceptJob` called `accept(providerId, id, lat, lng)` — but `accept` is
 *     `(providerId, id, eta?: number)` with NO GPS parameters, so the partner's LATITUDE was being
 *     recorded as the job ETA in minutes (e.g. eta = 28.6), plus a 4th undeclared argument.
 *  3. `write.partner.rejectJob` passed `reason: undefined` into a REQUIRED `reason: string` that is
 *     forwarded to `assignmentEngine.onProviderRejected(...)`, i.e. straight into the dispatch and
 *     reassignment path.
 *
 * These assert the CONTRACT (arity + call shape) rather than re-running the money paths, so the
 * guard is deterministic and cannot mutate bookings, wallets or the ledger.
 */
import "../load-env";
import { describe, test, expect, beforeAll } from "bun:test";
import { bookingService } from "../services/booking.service";

describe("P3-8 A — booking service contracts the AI tools must honour", () => {
  test("cancel() takes an ACTOR OBJECT first, not a user id string", () => {
    // Arity is the machine-checkable half of the contract: (actor, id, reason) === 3.
    expect(bookingService.cancel.length).toBe(3);
  });

  test("accept() takes (providerId, id, eta?) — it has no latitude/longitude parameters", () => {
    // (providerId, id, eta?) === 3. A TS optional parameter with no default still counts toward
    // Function.length. If this ever becomes 4, someone has added GPS parameters and the acceptJob
    // handler should be revisited before forwarding lat/lng again.
    expect(bookingService.accept.length).toBe(3);
  });

  test("reject() requires a reason — it is forwarded into the dispatch path", () => {
    expect(bookingService.reject.length).toBe(3);
  });
});

describe("P3-8 A — the handlers call those contracts correctly", () => {
  /**
   * Asserts against the handler source. Importing the module would pull in the entire service
   * graph (Prisma, Razorpay, notifications) for what is a pure call-shape check, and actually
   * executing these handlers would mutate real bookings.
   */
  let src = "";

  beforeAll(async () => {
    const file = Bun.file(`${import.meta.dir}/../ai-tools/execution/handlers/index.ts`);
    // Collapse all whitespace so assertions are immune to line endings and formatting.
    src = (await file.text()).replace(/\s+/g, " ");
  });

  test("cancelBooking passes an actor object, not a bare id, and no bogus role argument", () => {
    expect(src).toContain("bookingService.cancel( { userId: actor.actorId },");
    // The 4th argument the signature never declared must not come back.
    expect(src).not.toContain('"Cancelled via AI tool", "CUSTOMER"');
  });

  test("acceptJob no longer passes latitude as the ETA", () => {
    expect(src).toContain("bookingService.accept(providerId, String(args.bookingId))");
    expect(src).not.toContain("args.lat != null ? Number(args.lat) : 0");
  });

  test("rejectJob always supplies a reason", () => {
    expect(src).toContain('args.reason ? String(args.reason) : "Rejected via AI tool"');
    expect(src).not.toContain("args.reason ? String(args.reason) : undefined");
  });
});

describe("P3-8 A — acceptJob tool schema matches the domain contract", () => {
  /**
   * `lat`/`lng` were advertised by the tool schema but had NO consumer anywhere in the accept
   * domain: `bookingService.accept(providerId, id, eta?)` has no GPS parameters and never reads
   * location, `bookingAcceptSchema` accepts only `eta`, and the real partner app posts only
   * `{ eta }`. Partner GPS has its own contract (`trackingLocationSchema` over
   * `/ws/tracking/:bookingId`). Classified legacy-with-no-consumer and removed, so the model can
   * no longer supply coordinates that are silently discarded.
   */
  test("acceptJob advertises only bookingId — no orphaned GPS inputs", async () => {
    const { TOOL_CATALOG } = await import("../ai-tools/registry/tool-catalog");
    const acceptJob = TOOL_CATALOG.find((t) => t.toolId === "write.partner.acceptJob");
    expect(acceptJob).toBeDefined();
    const names = acceptJob!.parameters.map((p) => p.name);
    expect(names).toEqual(["bookingId"]);
    expect(names).not.toContain("lat");
    expect(names).not.toContain("lng");
  });

  test("every acceptJob parameter has a real destination in the service signature", async () => {
    const { TOOL_CATALOG } = await import("../ai-tools/registry/tool-catalog");
    const acceptJob = TOOL_CATALOG.find((t) => t.toolId === "write.partner.acceptJob")!;
    // accept(providerId, id, eta?) — providerId is resolved from the actor, so the only
    // caller-supplied value the service can consume is the booking id.
    expect(acceptJob.parameters.every((p) => p.name === "bookingId")).toBe(true);
  });
});
