import { Elysia } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { notificationService } from "../services/notification.service";

export const notificationsRoutes = new Elysia({ prefix: "/api/notifications" })
  .use(authPlugin)
  .get("/", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const data = await notificationService.list(userId, {
      page,
      limit,
      type: query.type,
      unreadOnly: query.isRead === "false",
    });
    return { success: true, data: { ...data, page } };
  })
  .put("/:id/read", async ({ requireAuth, params }) => {
    const { userId } = requireAuth();
    await notificationService.markRead(userId, params.id);
    return { success: true, message: "Notification marked as read" };
  })
  .delete("/:id", async ({ requireAuth, params }) => {
    const { userId } = requireAuth();
    await notificationService.delete(userId, params.id);
    return { success: true, message: "Notification deleted" };
  });
