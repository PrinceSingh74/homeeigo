import { Elysia } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { notificationService } from "../services/notification.service";
import {
  categoryDefaultChannels,
  evaluatePreferences,
  isMandatory,
} from "../notifications/preferences.service";
import { resolveChannelAvailability } from "../notifications/channel-availability";
import prisma from "../lib/prisma";
import type { NotificationCategory, NotificationChannel } from "@prisma/client";

export const notificationsRoutes = new Elysia({ prefix: "/api/notifications" })
  .use(authPlugin)
  /**
   * The complete preference matrix, ready to render.
   *
   * Returns every (channel, category) cell rather than only the rows a recipient happens to have
   * saved, because a settings screen has to show the state of a control that has never been
   * touched. The effective value is resolved through `decidePreference` — the same function the
   * router uses — so what the screen displays and what the platform does cannot disagree.
   */
  .get("/preferences", async ({ requireAuth }) => {
    const { userId } = requireAuth();

    const [rows, channels] = await Promise.all([
      prisma.notificationPreference.findMany({
        where: { userId },
        select: { channel: true, category: true, enabled: true, language: true },
      }),
      resolveChannelAvailability(userId),
    ]);

    const allCategories: NotificationCategory[] = ["TRANSACTIONAL", "SECURITY", "OPTIONAL"];
    /**
     * One read for the whole matrix. Each of the 3x4 cells used to call the async evaluator, which
     * issued its own `findUnique` — twelve queries restating rows this handler had already fetched
     * above. `evaluatePreferences` decides every cell through the same `decidePreference` the router
     * uses, so what the screen shows and what the platform does still cannot disagree; only the
     * number of times the rows are read has changed.
     */
    const cells = allCategories.flatMap((category) =>
      channels.map(({ channel, available, reason }) => ({ category, channel, available, reason })),
    );
    const decisions = await evaluatePreferences(
      userId,
      cells.map(({ channel, category }) => ({ channel, category })),
    );
    const matrix = cells.map((cell, i) => {
      const decision = decisions[i]!;
      return {
        category: cell.category,
        channel: cell.channel,
        enabled: decision.allowed,
        /** Mandatory cells are locked; unavailable channels have nothing to lock. */
        editable: cell.available && !isMandatory(cell.category),
        mandatory: isMandatory(cell.category),
        available: cell.available,
        unavailableReason: cell.reason,
        source: decision.reason,
      };
    });

    return {
      success: true,
      data: {
        preferences: rows,
        channels,
        matrix,
      },
    };
  })
  .put("/preferences", async ({ requireAuth, body, set }) => {
    const { userId } = requireAuth();
    const input = body as {
      channel: NotificationChannel;
      category: NotificationCategory;
      enabled: boolean;
      language?: string;
    };
    /**
     * Refused with a status, not a 200 carrying `success: false` — a client that only checks the
     * HTTP code would otherwise show the toggle as saved and leave the recipient believing they
     * had switched off a message the platform is obliged to deliver.
     */
    if (isMandatory(input.category) && !input.enabled) {
      set.status = 422;
      return { success: false, error: "Mandatory categories cannot be disabled", code: "MANDATORY_CATEGORY" };
    }
    const row = await prisma.notificationPreference.upsert({
      where: {
        userId_channel_category: {
          userId,
          channel: input.channel,
          category: input.category,
        },
      },
      create: {
        userId,
        channel: input.channel,
        category: input.category,
        enabled: input.enabled,
        language: input.language ?? null,
      },
      update: {
        enabled: input.enabled,
        language: input.language ?? null,
      },
    });
    return { success: true, data: row };
  })
  .get("/preferences/defaults", async () => {
    const categories: NotificationCategory[] = ["SECURITY", "TRANSACTIONAL", "OPTIONAL"];
    const defaults = categories.map((category) => ({
      category,
      mandatory: isMandatory(category),
      channels: categoryDefaultChannels(category),
    }));
    return { success: true, data: { defaults } };
  })
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
  // NOTE: must be registered before "/:id/read" so "read-all" isn't captured as an id.
  .put("/read-all", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const count = await notificationService.markAllRead(userId);
    return { success: true, message: "All notifications marked as read", data: { count } };
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
