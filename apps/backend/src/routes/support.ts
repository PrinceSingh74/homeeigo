import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { supportTicketService } from "../services/support-ticket.service";

export const supportRoutes = new Elysia({ prefix: "/api/support" })
  .use(authPlugin)
  .post(
    "/tickets",
    async ({ requireAuth, body }) => {
      const { userId } = requireAuth();
      const ticket = await supportTicketService.create(userId, body);
      return { success: true, message: "Support ticket created", data: { ticket } };
    },
    {
      body: t.Object({
        subject: t.String({ minLength: 3, maxLength: 200 }),
        description: t.String({ minLength: 10, maxLength: 5000 }),
        category: t.String({ minLength: 2, maxLength: 80 }),
        bookingId: t.Optional(t.String()),
        attachments: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .get("/tickets", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    const data = await supportTicketService.listForUser(userId, query as Record<string, string>);
    return { success: true, data };
  });
