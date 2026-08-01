import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { supportTicketService } from "../services/support-ticket.service";

export const supportRoutes = new Elysia({ prefix: "/api/support" })
  .use(authPlugin)
  .post(
    "/tickets",
    async ({ requireAuth, body, set }) => {
      const auth = requireAuth();
      try {
        const ticket = await supportTicketService.create(
          auth.userId,
          {
            subject: body.subject,
            description: body.description,
            category: body.category,
            bookingId: body.bookingId,
            attachments: body.attachments,
            priorityLevel: body.priorityLevel,
          },
          { providerId: auth.providerId },
        );
        return { success: true, message: "Support ticket created", data: { ticket } };
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "BOOKING_NOT_FOUND") {
          set.status = 404;
          return {
            success: false,
            error: "Booking not found. Use your HOMEEIGO booking reference or leave the field blank.",
            code: "BOOKING_NOT_FOUND",
          };
        }
        if (code === "BOOKING_ACCESS_DENIED") {
          set.status = 403;
          return {
            success: false,
            error: "That booking is not linked to your account.",
            code: "BOOKING_ACCESS_DENIED",
          };
        }
        throw error;
      }
    },
    {
      body: t.Object({
        subject: t.String({ minLength: 3, maxLength: 200 }),
        description: t.String({ minLength: 10, maxLength: 5000 }),
        category: t.String({ minLength: 2, maxLength: 80 }),
        bookingId: t.Optional(t.String()),
        attachments: t.Optional(t.Array(t.String())),
        priorityLevel: t.Optional(t.String()),
      }),
    },
  )
  .get("/tickets", async ({ requireAuth, query }) => {
    const auth = requireAuth();
    const data = await supportTicketService.listForUser(
      auth.userId,
      query as Record<string, string>,
      auth.providerId,
    );
    return { success: true, data };
  })
  .get("/tickets/:id", async ({ requireAuth, params, set }) => {
    const auth = requireAuth();
    const ticket = await supportTicketService.getForUser(params.id, auth.userId, auth.providerId);
    if (!ticket) {
      set.status = 404;
      return { success: false, error: "Ticket not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { ticket } };
  })
  .post(
    "/tickets/:id/reply",
    async ({ requireAuth, params, body, set }) => {
      const auth = requireAuth();
      const result = await supportTicketService.userReply(
        params.id,
        auth.userId,
        body.body,
        auth.providerId,
      );
      if (result.error === "NOT_FOUND") {
        set.status = 404;
        return { success: false, error: "Ticket not found", code: "NOT_FOUND" };
      }
      if (result.error === "CLOSED") {
        set.status = 400;
        return { success: false, error: "Ticket is closed", code: "CLOSED" };
      }
      return { success: true, message: "Reply sent", data: { message: result.message } };
    },
    { body: t.Object({ body: t.String({ minLength: 1, maxLength: 5000 }) }) },
  );
