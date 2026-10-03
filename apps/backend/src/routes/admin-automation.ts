import { Elysia, t } from "elysia";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { adminAutomationService } from "../services/admin-automation.service";

/**
 * Section 09 — Admin Automation Center API.
 *
 * Read-only inspection of workflows, triggers, events, instances, outbox and DLQ.
 * DLQ replay requires UPDATE on SETTINGS (operational control).
 */
export const adminAutomationRoutes = new Elysia({ prefix: "/automation" })
  .use(adminRbacPlugin)

  .get("/overview", async () => {
    const data = await adminAutomationService.getOverview();
    return { success: true, data };
  })

  .get("/instances", async ({ query }) => {
    const data = await adminAutomationService.listInstances({
      workflowId: query.workflowId,
      status: query.status,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return { success: true, data };
  }, {
    query: t.Object({
      workflowId: t.Optional(t.String()),
      status: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  .get("/dead-letters", async ({ query }) => {
    const data = await adminAutomationService.listDeadLetters(
      query.limit ? Number(query.limit) : undefined,
    );
    return { success: true, data };
  }, {
    query: t.Object({ limit: t.Optional(t.String()) }),
  })

  .get("/outbox", async ({ query }) => {
    const data = await adminAutomationService.listOutbox({
      status: query.status,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return { success: true, data };
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  /**
   * §56 — a replay names its reason. The body is required rather than optional: an operator who
   * cannot say why they are re-running a consumer against a real event should not be doing it,
   * and a reason collected after the fact is not evidence.
   */
  .post("/dead-letters/:id/replay", async ({ params, body, requireAdminContext }) => {
    const admin = requireAdminContext();
    const data = await adminAutomationService.replayDeadLetter(
      params.id,
      admin.userId,
      body.reason,
    );
    return { success: true, data };
  }, {
    body: t.Object({ reason: t.String({ minLength: 10, maxLength: 500 }) }),
  });
