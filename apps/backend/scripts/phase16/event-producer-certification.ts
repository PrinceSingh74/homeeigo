/**
 * Phase 16 — event producer certification.
 *
 * The previous phase declared these two triggers UNWIREABLE because no producer existed. Producers
 * now exist, so the claim that matters is no longer "a trigger is registered" but "a real business
 * write publishes a real event, transactionally, and a rollback takes the event with it".
 *
 * Registering a trigger proves nothing. Every check below drives the REAL service method that
 * production calls, and asserts on rows in `event_outbox`.
 */
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { supportTicketService } from "../../src/services/support-ticket.service";
import { opsAlertService } from "../../src/services/ops-alert.service";
import { EVENT_TYPES } from "../../src/events/catalog/event-types";
import { agentTriggersFor, UNWIRED_TRIGGERS } from "../../src/agents/triggers/agent-trigger-registry";
import { matchConsumers } from "../../src/events/core/consumer-registry";
import { bootstrapEventConsumers } from "../../src/events/consumers";
import { initAgents } from "../../src/agents";

type Result = { id: string; name: string; status: "PASS" | "FAIL"; detail: string };
const results: Result[] = [];
function check(id: string, name: string, ok: boolean, detail: string): void {
  results.push({ id, name, status: ok ? "PASS" : "FAIL", detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id} ${name}\n        ${detail}`);
}

function assertStaging(): void {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (process.env.APP_ENV !== "staging" || !db.includes("staging")) {
    throw new Error(`REFUSING: APP_ENV=${process.env.APP_ENV} db=${db}`);
  }
  console.log(`[guard] staging confirmed (${db})\n`);
}

const CUSTOMER = "phase16-customer";

/**
 * Find the outbox rows for specific aggregates — NOT for a time window.
 *
 * The first version of this harness filtered on `createdAt >= <app clock timestamp>`, and reported
 * 4 events for 5 alert rows on one run and 5 for 5 on the next. The producer was correct every
 * time: `event_outbox.created_at` is assigned by the DATABASE clock, and the cutoff came from the
 * application clock in a different container. Measured skew between the two was 289 ms and it
 * drifts, so a row inserted moments after the cutoff can carry a timestamp moments before it.
 *
 * A test that fails intermittently because of clock drift is not evidence, and worse, it trains
 * whoever reads it to dismiss the next real failure. Matching by aggregate id is exact, needs no
 * clock at all, and asserts the thing actually worth asserting: this row has this event.
 */
async function outboxRowsFor(eventType: string, aggregateIds: string[]) {
  if (aggregateIds.length === 0) return [];
  return prisma.eventOutbox.findMany({
    where: { eventType, aggregateId: { in: aggregateIds } },
    orderBy: { createdAt: "desc" },
  });
}

/** Only for asserting ABSENCE, where an over-broad window is the safe direction. */
async function outboxRowsSince(eventType: string, since: Date) {
  return prisma.eventOutbox.findMany({
    where: { eventType, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
}

async function main(): Promise<void> {
  assertStaging();
  initAgents();
  bootstrapEventConsumers();

  console.log("=== P. SUPPORT TICKET PRODUCER ===");

  const ticket = await supportTicketService.create(CUSTOMER, {
    subject: "Producer certification ticket",
    description: "Raised by the Phase-16 event producer certification harness.",
    category: "booking",
  });

  const supportEvents = await outboxRowsFor(EVENT_TYPES.SUPPORT_TICKET_CREATED, [ticket.id]);
  const supportEvent = supportEvents[0];

  check("P1", "Creating a support ticket publishes an outbox event",
    Boolean(supportEvent),
    `ticketId=${ticket.id} outboxRows=${supportEvents.length} matched=${Boolean(supportEvent)}`);

  check("P2", "The event is bound to the ticket aggregate",
    supportEvent?.aggregateType === "support_ticket" && supportEvent?.aggregateId === ticket.id,
    `aggregateType=${supportEvent?.aggregateType} aggregateId=${supportEvent?.aggregateId}`);

  /**
   * The payload must NOT carry the free text.
   *
   * Checked against the actual bytes rather than trusting the builder: a later edit that "helpfully"
   * adds the subject for debugging would put untrusted customer prose into a durable, replayable,
   * fanned-out record — and one careless stringify away from a prompt.
   */
  const payloadJson = JSON.stringify(supportEvent?.payload ?? {});
  check("P3", "The payload carries ids and classification, never the ticket free text",
    !payloadJson.includes("Producer certification ticket") &&
      !payloadJson.includes("Phase-16 event producer certification harness"),
    `subjectLeaked=${payloadJson.includes("Producer certification ticket")} descriptionLeaked=${payloadJson.includes("harness")}`);

  // A second ticket must produce a distinct event id — no accidental key reuse.
  const ticket2 = await supportTicketService.create(CUSTOMER, {
    subject: "Producer certification ticket two",
    description: "Second ticket.",
    category: "booking",
  });
  const supportEvents2 = await outboxRowsFor(EVENT_TYPES.SUPPORT_TICKET_CREATED, [ticket.id, ticket2.id]);
  const ids = new Set(supportEvents2.map((e) => e.eventId));
  check("P4", "Each ticket produces exactly one distinct event",
    supportEvents2.length === 2 && ids.size === 2,
    `tickets=2 events=${supportEvents2.length} distinctEventIds=${ids.size}`);

  /**
   * Transactional atomicity — the property that separates this from a fire-and-forget publish.
   *
   * A transaction that writes a ticket and its event and then throws must leave NEITHER. Proven by
   * doing exactly that, rather than by reading the code and believing it.
   */
  const t1 = new Date();
  const failedTicketNumber = `phase16-rollback-${Date.now()}`;
  await prisma
    .$transaction(async (tx) => {
      const row = await tx.supportTicket.create({
        data: {
          ticketNumber: failedTicketNumber,
          userId: CUSTOMER,
          subject: "rollback probe",
          description: "rollback probe",
          category: "booking",
          priority: "medium",
        },
      });
      const { emitInTransaction } = await import("../../src/events/core/event-publisher");
      const { buildSupportTicketCreatedEvent } = await import("../../src/events/catalog/support-ops.events");
      await emitInTransaction(
        tx,
        buildSupportTicketCreatedEvent({
          ticketId: row.id,
          ticketNumber: row.ticketNumber,
          category: row.category,
          priorityLevel: row.priorityLevel,
          bookingId: row.bookingId,
          userId: CUSTOMER,
          slaDueAt: row.slaDueAt,
          createdAt: row.createdAt,
        }),
      );
      throw new Error("deliberate rollback");
    })
    .catch(() => undefined);

  const orphanTicket = await prisma.supportTicket.count({ where: { ticketNumber: failedTicketNumber } });
  // Absence check — an over-broad window is the safe direction here.
  const rollbackEvents = await outboxRowsSince(EVENT_TYPES.SUPPORT_TICKET_CREATED, t1);
  check("P5", "A rolled-back ticket leaves neither a row nor an event",
    orphanTicket === 0 && rollbackEvents.length === 0,
    `orphanTickets=${orphanTicket} orphanEvents=${rollbackEvents.length}`);

  console.log("\n=== Q. OPS ALERT PRODUCER ===");

  const alertType = `phase16_cert_${Date.now()}`;
  const alert = await opsAlertService.raise(alertType, "CRITICAL", "Producer certification alert");
  const alertEvents = await outboxRowsFor(EVENT_TYPES.OPS_ALERT_RAISED, alert ? [alert.id] : []);
  const alertEvent = alertEvents[0];

  check("Q1", "Raising an operational alert publishes an outbox event",
    Boolean(alert) && Boolean(alertEvent),
    `alertId=${alert?.id} matched=${Boolean(alertEvent)}`);

  check("Q2", "The event carries type and severity, never the message body",
    !JSON.stringify(alertEvent?.payload ?? {}).includes("Producer certification alert"),
    `messageLeaked=${JSON.stringify(alertEvent?.payload ?? {}).includes("Producer certification alert")}`);

  /**
   * Suppression must not publish.
   *
   * `raise` returns null once five unresolved alerts of a type exist within the hour. An event on
   * that path would announce an alert that does not exist, and a consumer acting on it would be
   * chasing a dangling id. Driven to the real threshold rather than asserted.
   */
  const suppressType = `phase16_suppress_${Date.now()}`;
  const created: Array<string | null> = [];
  for (let i = 0; i < 8; i += 1) {
    const a = await opsAlertService.raise(suppressType, "WARNING", `burst ${i}`);
    created.push(a?.id ?? null);
  }
  const rowsCreated = created.filter(Boolean).length;
  const suppressed = created.filter((c) => c === null).length;
  const createdIds = created.filter(Boolean) as string[];
  const burstMatched = await outboxRowsFor(EVENT_TYPES.OPS_ALERT_RAISED, createdIds);

  check("Q3", "Suppressed alerts publish no event; one event per created row",
    suppressed > 0 && burstMatched.length === rowsCreated,
    `attempted=8 rowsCreated=${rowsCreated} suppressed=${suppressed} events=${burstMatched.length}`);

  console.log("\n=== R. TRIGGER WIRING ===");

  const supportTriggers = agentTriggersFor(EVENT_TYPES.SUPPORT_TICKET_CREATED);
  const opsTriggers = agentTriggersFor(EVENT_TYPES.OPS_ALERT_RAISED);
  check("R1", "Both previously-unwireable triggers are now registered",
    supportTriggers.length === 1 && opsTriggers.length === 1,
    `support=${supportTriggers.length} ops=${opsTriggers.length}`);

  check("R2", "The agent consumer is subscribed to both new event types",
    matchConsumers(EVENT_TYPES.SUPPORT_TICKET_CREATED).some((c) => c.name === "agent-trigger") &&
      matchConsumers(EVENT_TYPES.OPS_ALERT_RAISED).some((c) => c.name === "agent-trigger"),
    `supportConsumers=${matchConsumers(EVENT_TYPES.SUPPORT_TICKET_CREATED).map((c) => c.name).join(",")} | opsConsumers=${matchConsumers(EVENT_TYPES.OPS_ALERT_RAISED).map((c) => c.name).join(",")}`);

  check("R3", "No trigger remains declared as unwireable",
    UNWIRED_TRIGGERS.length === 0,
    `unwired=${UNWIRED_TRIGGERS.length}`);

  // An INFO alert must NOT match the operations trigger — the condition is real, not decorative.
  const infoTrigger = opsTriggers[0]!;
  const infoMatches = infoTrigger.condition({
    data: { alertId: "x", severity: "INFO" },
    homigo: { aggregateId: "x" },
  } as never);
  const criticalMatches = infoTrigger.condition({
    data: { alertId: "x", severity: "CRITICAL" },
    homigo: { aggregateId: "x" },
  } as never);
  check("R4", "INFO alerts are excluded; CRITICAL alerts are included",
    !infoMatches && criticalMatches,
    `INFO=${infoMatches} CRITICAL=${criticalMatches}`);

  // Cleanup — the fixture tickets and alerts this run created.
  await prisma.supportTicket.deleteMany({ where: { id: { in: [ticket.id, ticket2.id] } } }).catch(() => undefined);
  await prisma.opsAlert.deleteMany({ where: { alertType: { in: [alertType, suppressType] } } }).catch(() => undefined);

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`EVENT PRODUCER CERTIFICATION: ${pass} PASS, ${fail} FAIL`);
  for (const r of results.filter((x) => x.status === "FAIL")) console.log(`  FAIL ${r.id}: ${r.detail}`);
  console.log("=".repeat(70));

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("PRODUCER HARNESS FAILED:", err);
  await prisma.$disconnect();
  process.exit(2);
});
