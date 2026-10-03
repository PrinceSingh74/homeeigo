/**
 * Phase 10 §5 — the execution state machine: rules and where they are enforced.
 *
 * The lifecycle already had ONE transition table (lib/booking-state-machine). The audit found the
 * holes around it rather than in it: writers that checked the table and then wrote without it, a
 * payment override that outlived the state it was granted for, transitions nobody was recorded as
 * making, and no enforcement below the application at all. This file pins the rules; the
 * integration file proves them against a database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import {
  ACTIVE_BOOKING_STATUSES,
  TERMINAL_BOOKING_STATUSES,
  isBookingTransitionAllowed,
  predecessorsOf,
} from "../lib/booking-state-machine";
import {
  PAYMENT_GATE_REASON,
  RETURNED_PAYMENT_STATUSES,
  evaluatePaymentGate,
  isPaymentReturned,
} from "../services/booking-payment-gate";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");
const ALL = Object.values(BookingStatus);
const override = { adminId: "admin-1", reason: "customer paying cash on site" };

describe("the canonical progression is the existing table — no second engine", () => {
  test("ASSIGNED/ACCEPTED → EN_ROUTE → IN_PROGRESS → COMPLETED is allowed", () => {
    expect(isBookingTransitionAllowed(BookingStatus.PENDING, BookingStatus.ACCEPTED)).toBe(true);
    expect(isBookingTransitionAllowed(BookingStatus.ACCEPTED, BookingStatus.EN_ROUTE)).toBe(true);
    expect(isBookingTransitionAllowed(BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE)).toBe(true);
    expect(isBookingTransitionAllowed(BookingStatus.EN_ROUTE, BookingStatus.IN_PROGRESS)).toBe(true);
    expect(isBookingTransitionAllowed(BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED)).toBe(true);
  });

  test("arrival and verification are facts on the row, not statuses (ADR-018)", () => {
    // The brief's ARRIVAL / VERIFICATION stages map to arrivedAt and the start-PIN record; adding
    // them as statuses would fork every consumer of the enum.
    expect(ALL).not.toContain("ARRIVED" as BookingStatus);
    expect(ALL).not.toContain("VERIFIED" as BookingStatus);
  });

  test("work cannot skip straight to completion", () => {
    for (const s of [BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE]) {
      expect(isBookingTransitionAllowed(s, BookingStatus.COMPLETED)).toBe(false);
    }
  });
});

describe("the forbidden transitions the brief names", () => {
  test("no terminal status has any successor — no resurrection", () => {
    for (const from of TERMINAL_BOOKING_STATUSES) {
      for (const to of ALL) expect(isBookingTransitionAllowed(from, to)).toBe(false);
    }
  });

  test("no-show → start, expired → accept, cancelled → start", () => {
    expect(isBookingTransitionAllowed(BookingStatus.CUSTOMER_NO_SHOW, BookingStatus.IN_PROGRESS)).toBe(false);
    expect(isBookingTransitionAllowed(BookingStatus.PROVIDER_NO_SHOW, BookingStatus.IN_PROGRESS)).toBe(false);
    expect(isBookingTransitionAllowed(BookingStatus.EXPIRED, BookingStatus.ACCEPTED)).toBe(false);
    expect(isBookingTransitionAllowed(BookingStatus.CANCELLED_BY_USER, BookingStatus.IN_PROGRESS)).toBe(false);
    expect(isBookingTransitionAllowed(BookingStatus.CANCELLED_BY_PROVIDER, BookingStatus.IN_PROGRESS)).toBe(false);
  });

  test("the two no-shows can never be converted into one another", () => {
    expect(isBookingTransitionAllowed(BookingStatus.CUSTOMER_NO_SHOW, BookingStatus.PROVIDER_NO_SHOW)).toBe(false);
    expect(isBookingTransitionAllowed(BookingStatus.PROVIDER_NO_SHOW, BookingStatus.CUSTOMER_NO_SHOW)).toBe(false);
  });

  test("the start guard is exactly the table's predecessors of IN_PROGRESS", () => {
    expect(predecessorsOf(BookingStatus.IN_PROGRESS).sort()).toEqual(["ACCEPTED", "ASSIGNED", "EN_ROUTE"]);
  });
});

describe("refunded → start: returned money is never overridable", () => {
  test("an override still lets an admin dispatch money that has not arrived yet", () => {
    for (const s of [PaymentStatus.PENDING, PaymentStatus.INITIATED, PaymentStatus.PROCESSING, PaymentStatus.FAILED]) {
      expect(evaluatePaymentGate(s, override).allowed).toBe(true);
    }
  });

  test("…but not money that has gone back, or whose window closed", () => {
    expect(RETURNED_PAYMENT_STATUSES).toEqual([PaymentStatus.REFUNDED, PaymentStatus.REFUNDING, PaymentStatus.EXPIRED]);
    for (const s of RETURNED_PAYMENT_STATUSES) {
      const v = evaluatePaymentGate(s, override);
      expect(v.allowed).toBe(false);
      expect(v.overridden).toBeUndefined();
      // No new error code: routes already map NOT_SETTLED (see "route falls through to success").
      expect(v.reason).toBe(PAYMENT_GATE_REASON.NOT_SETTLED);
    }
  });

  test("a goodwill partial refund on a live job does not end the job", () => {
    expect(isPaymentReturned(PaymentStatus.PARTIALLY_REFUNDED)).toBe(false);
    expect(evaluatePaymentGate(PaymentStatus.PARTIALLY_REFUNDED, override).allowed).toBe(true);
  });

  test("start's forced path refuses returned money before it looks for an override", () => {
    const s = read("src/services/booking.service.ts");
    const refusal = s.indexOf("if (isPaymentReturned(current.paymentStatus)) throw new Error(PAYMENT_GATE_REASON.NOT_SETTLED);");
    const lookup = s.indexOf("const overridden = (await hasAuditedPaymentGateOverride(id, tx))");
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(lookup);
  });
});

describe("terminal immutability is enforced below the application", () => {
  const sql = read("prisma/migrations/20260924120000_booking_terminal_status_guard/migration.sql");

  test("the trigger's terminal list IS TERMINAL_BOOKING_STATUSES — one policy, two enforcers", () => {
    const listed = sql.match(/OLD\.status::text IN \(([^)]*)\)/)![1].match(/'([A-Z_]+)'/g)!.map((x) => x.slice(1, -1));
    expect([...listed].sort()).toEqual([...TERMINAL_BOOKING_STATUSES].sort());
  });

  test("it guards status only — it does not re-implement the transition table", () => {
    expect(sql).toContain("BEFORE UPDATE OF status ON \"bookings\"");
    for (const s of ACTIVE_BOOKING_STATUSES) expect(sql.includes(`'${s}'`)).toBe(false);
  });

  test("the migration is additive — nothing destructive", () => {
    expect(/\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN)\b/i.test(sql)).toBe(false);
  });
});

describe("every status writer is conditional on the state it checked", () => {
  /**
   * Scans every `booking.update(…)` / `booking.updateMany(…)` in src/ (tests excluded) whose data
   * sets `status`, and requires the `where` to name a status too. One writer is exempt, with its
   * reason: accept() writes `where { id }` inside a transaction that already holds the row FOR UPDATE
   * and has checked the status under that lock.
   */
  const EXEMPT = new Set(["src/services/booking.service.ts#ACCEPTED"]);

  function files(dir: string): string[] {
    return readdirSync(resolve(BACKEND, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? e.name === "__tests__" ? [] : files(`${dir}/${e.name}`)
        : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : [],
    );
  }

  test("no unguarded status write exists", () => {
    const offenders: string[] = [];
    for (const f of files("src")) {
      const s = read(f);
      const re = /\bbooking\.(update|updateMany)\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        let i = m.index + m[0].length;
        let depth = 1;
        while (depth && i < s.length) {
          if (s[i] === "(") depth++;
          else if (s[i] === ")") depth--;
          i++;
        }
        const arg = s.slice(m.index + m[0].length, i - 1);
        const at = arg.search(/\bdata\s*:/);
        if (at < 0) continue;
        const where = arg.slice(0, at);
        const data = arg.slice(at);
        // Both `status: X` and the shorthand `{ status, … }` (how the old no-show writer was written).
        // A property KEY only: `refundStatus: result.status }` is not a status write.
        const target = data.match(/(?<![.\w])status\s*(?::\s*(?:BookingStatus\.)?["']?([A-Z_]+|status)\b|[,}])/);
        if (!target) continue;
        if (EXEMPT.has(`${f}#${target[1]}`)) continue;
        if (!/\bstatus\s*:/.test(where)) offenders.push(`${f}:${s.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the exemption is still true: accept locks the row before it writes", () => {
    const s = read("src/services/booking.service.ts");
    const lock = s.indexOf("FOR UPDATE", s.indexOf("async accept("));
    const write = s.indexOf('status: "ACCEPTED",', lock);
    expect(lock).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(lock);
    expect(s.slice(lock, write)).toContain('if (row.status !== "PENDING")');
  });

  test("arrival and en-route writes name the partner and the live statuses", () => {
    const t = read("src/services/tracking.service.ts");
    expect(t).toContain('status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },');
    expect((t.match(/providerId: input\.providerId,\n|providerId: input\.providerId,\r\n/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("every transition is attributed", () => {
  test("every service that writes booking status or partner sets the audit context", () => {
    for (const f of [
      "src/services/booking.service.ts",
      "src/services/booking-no-show.service.ts",
      "src/services/booking-payment-expiry.service.ts",
      "src/services/admin-booking-operations.service.ts",
      "src/services/tracking.service.ts",
      "src/services/assignment-engine.service.ts",
    ]) {
      expect(read(f).includes("setBookingAuditContext(tx"), f).toBe(true);
    }
  });

  test("the trace id travels with the request id", () => {
    expect(read("src/lib/booking-audit-context.ts")).toContain("set_config('homigo.trace_id', ${traceId}, true)");
  });

  test("admin completion is recorded as the admin, not the partner", () => {
    expect(read("src/services/admin-booking-operations.service.ts")).toContain(
      '{ auditActor: { actorType: "admin", actorId: adminId, reason } },',
    );
  });

  test("an admin no-show carries the admin's reason into the history", () => {
    const r = read("src/routes/admin.ts");
    expect((r.match(/isAdmin: true, reason: body\.reason \}/g) ?? []).length).toBe(2);
  });

  test("expiry reaches the open apps through the one publisher", () => {
    expect(read("src/services/booking-payment-expiry.service.ts")).toContain('status: "EXPIRED",');
  });
});

describe("frontends cannot bypass transition authority", () => {
  test("no route writes a booking directly — every transition is a service command", () => {
    const routes = readdirSync(resolve(BACKEND, "src/routes")).filter((f) => f.endsWith(".ts"));
    for (const f of routes) {
      const s = read(`src/routes/${f}`);
      expect(/\bbooking\.(update|updateMany|upsert)\(/.test(s), `src/routes/${f} writes bookings directly`).toBe(false);
    }
  });

  test("no booking route accepts a target status from the client", () => {
    for (const f of ["src/routes/bookings.ts", "src/routes/admin.ts"]) {
      const s = read(f);
      // A body field naming the booking's next state would make the client the authority.
      expect(/body:\s*t\.Object\(\{[^}]*\bstatus:\s*t\.(Union|Enum|String)/.test(s), f).toBe(false);
    }
  });
});
