import { Elysia, t } from "elysia";
import prisma from "../lib/prisma";
import { publicUser } from "../lib/format";
import { authPlugin } from "../plugins/auth.plugin";
import { parseBody } from "../lib/route-security";
import {
  createAddressSchema,
  updateAddressSchema,
  updateMeSchema,
  userPreferencesSchema,
} from "../schemas/user.schema";
import { validate } from "../middleware/validation.middleware";
import { registerPushTokenSchema } from "../schemas/ai.schema";
import { idParamSchema } from "../schemas/common.schema";
import { addressService } from "../services/address.service";
import { bookingService } from "../services/booking.service";
import { devicePushService } from "../services/device-push.service";
import { ratingService } from "../services/rating.service";
import { accountLifecycleService } from "../services/account-lifecycle.service";
import { dataExportService } from "../services/data-export.service";
import { ACCOUNT_DELETION_RESTORE_DAYS } from "../lib/legal-policy";
import { userPiiService } from "../services/user-pii.service";

const userProfileSelect = {
  id: true,
  email: true,
  phoneNumber: true,
  firstName: true,
  lastName: true,
  profileImage: true,
  bio: true,
  walletBalance: true,
  totalSpent: true,
  kycStatus: true,
  isEmailVerified: true,
  isPhoneVerified: true,
  darkMode: true,
  notificationsEnabled: true,
  emailNotifications: true,
  pushNotifications: true,
  smsNotifications: true,
  defaultLanguage: true,
  createdAt: true,
  referralCode: true,
  referralCount: true,
  emailEncrypted: true,
  phoneEncrypted: true,
  emailHash: true,
  phoneHash: true,
  emailEncryptionKeyVersion: true,
  phoneEncryptionKeyVersion: true,
  dataEncryptionStatus: true,
} as const;

const usersApp = new Elysia({ prefix: "/api/users" })
  .use(authPlugin)
  .get("/me", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: userProfileSelect });
    if (!user) return { success: false, error: "User not found", code: "NOT_FOUND" };
    const withPii = await userPiiService.withDecryptedPii(user, { actorId: userId, authorized: true });
    return { success: true, data: { user: publicUser(withPii) } };
  })
  .get("/me/export", async ({ requireAuth, query, set }) => {
    const { userId } = requireAuth();
    const format = (query as { format?: string }).format ?? "json";
    if (format === "zip") {
      const zip = await dataExportService.exportZip(userId);
      if (!zip) {
        set.status = 404;
        return { success: false, error: "User not found", code: "NOT_FOUND" };
      }
      set.headers["content-type"] = "application/zip";
      set.headers["content-disposition"] = `attachment; filename="homigo-export-${userId.slice(0, 8)}.zip"`;
      return zip;
    }
    const data = await dataExportService.exportJson(userId);
    if (!data) {
      set.status = 404;
      return { success: false, error: "User not found", code: "NOT_FOUND" };
    }
    set.headers["content-disposition"] = `attachment; filename="homigo-export-${userId.slice(0, 8)}.json"`;
    return { success: true, data };
  })
  .delete("/me", async ({ requireAuth, body, set }) => {
    const { userId } = requireAuth();
    if (!body?.confirm) {
      set.status = 400;
      return { success: false, error: "Confirmation required", code: "CONFIRMATION_REQUIRED" };
    }
    const result = await accountLifecycleService.scheduleDeletion(userId, body.reason);
    if ("error" in result) {
      set.status = 404;
      return { success: false, error: "User not found", code: "NOT_FOUND" };
    }
    return {
      success: true,
      message: `Account scheduled for deletion. You may restore within ${ACCOUNT_DELETION_RESTORE_DAYS} days by contacting support.`,
      data: result,
    };
  }, { body: t.Optional(t.Object({ confirm: t.Boolean(), reason: t.Optional(t.String()) })) })
  .put(
    "/me",
    async ({ requireAuth, body: raw }) => {
      const { userId } = requireAuth();
      const body = parseBody(updateMeSchema, raw, {
        firstName: { maxLen: 50 },
        lastName: { maxLen: 50 },
        bio: { maxLen: 500 },
        profileImage: { url: true },
      });
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          bio: body.bio,
          profileImage: body.profileImage,
          darkMode: body.darkMode,
          notificationsEnabled: body.notificationsEnabled,
        },
        select: userProfileSelect,
      });
      return {
        success: true,
        message: "Profile updated successfully",
        data: { user: publicUser(user) },
      };
    },
    {
      body: t.Object({
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
        bio: t.Optional(t.String()),
        profileImage: t.Optional(t.String()),
        darkMode: t.Optional(t.Boolean()),
        notificationsEnabled: t.Optional(t.Boolean()),
      }),
    },
  )
  .get("/addresses", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const addresses = await addressService.list(userId);
    return { success: true, data: { addresses } };
  })
  .post(
    "/addresses",
    async ({ requireAuth, body: raw, set }) => {
      const { userId } = requireAuth();
      const body = parseBody(createAddressSchema, raw);
      const address = await addressService.create(userId, body);
      set.status = 201;
      return {
        success: true,
        message: "Address added successfully",
        data: { address: { id: address.id, label: address.label, fullAddress: address.fullAddress, isDefault: address.isDefault } },
      };
    },
    {
      body: t.Object({
        label: t.String(),
        addressLine1: t.String(),
        addressLine2: t.Optional(t.String()),
        city: t.String(),
        state: t.String(),
        zipCode: t.String(),
        latitude: t.Number(),
        longitude: t.Number(),
        landmark: t.Optional(t.String()),
        specialInstructions: t.Optional(t.String()),
      }),
    },
  )
  .put(
    "/addresses/:id",
    async ({ requireAuth, params: rawParams, body: raw, set }) => {
      const { userId } = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(updateAddressSchema, raw);
      const address = await addressService.update(
        userId,
        params.id,
        body as Record<string, unknown>,
      );
      if (!address) {
        set.status = 404;
        return { success: false, error: "Address not found", code: "NOT_FOUND" };
      }
      return {
        success: true,
        message: "Address updated successfully",
        data: { address: { id: address.id, label: address.label } },
      };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .delete("/addresses/:id", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const result = await addressService.remove(userId, params.id);
    if (result.error === "ONLY_ADDRESS") {
      set.status = 400;
      return { success: false, error: "Cannot delete the only address", code: "ONLY_ADDRESS" };
    }
    if (result.error === "NOT_FOUND") {
      set.status = 404;
      return { success: false, error: "Address not found", code: "NOT_FOUND" };
    }
    return { success: true, message: "Address deleted successfully" };
  })
  .post("/addresses/:id/set-default", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const ok = await addressService.setDefault(userId, params.id);
    if (!ok) {
      set.status = 404;
      return { success: false, error: "Address not found", code: "NOT_FOUND" };
    }
    return { success: true, message: "Default address updated" };
  })
  .get("/bookings", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    const data = await bookingService.listForUser(userId, query);
    return { success: true, data };
  })
  .get("/bookings/:id", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const booking = await bookingService.getForUser(userId, params.id);
    if (!booking) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { booking } };
  })
  .get("/ratings", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    const data = await ratingService.listForUser(userId, query);
    return { success: true, data };
  })
  .put(
    "/preferences",
    async ({ requireAuth, body: raw }) => {
      const { userId } = requireAuth();
      const body = parseBody(userPreferencesSchema, raw);
      await prisma.user.update({
        where: { id: userId },
        data: {
          darkMode: body.darkMode,
          notificationsEnabled: body.notificationsEnabled,
          emailNotifications: body.emailNotifications,
          pushNotifications: body.pushNotifications,
          smsNotifications: body.smsNotifications,
          defaultLanguage: body.preferredLanguage,
        },
      });
      return { success: true, message: "Preferences updated successfully" };
    },
    {
      body: t.Object({
        darkMode: t.Optional(t.Boolean()),
        notificationsEnabled: t.Optional(t.Boolean()),
        emailNotifications: t.Optional(t.Boolean()),
        pushNotifications: t.Optional(t.Boolean()),
        smsNotifications: t.Optional(t.Boolean()),
        preferredLanguage: t.Optional(t.String()),
      }),
    },
  )
  .put(
    "/me/devices/push-token",
    async ({ requireAuth, body: raw }) => {
      const { userId } = requireAuth();
      const body = parseBody(registerPushTokenSchema, raw);
      const device = await devicePushService.upsertToken({
        userId,
        deviceId: body.deviceId,
        expoPushToken: body.expoPushToken,
        platform: body.platform,
        deviceName: body.deviceName,
        appVersion: body.appVersion,
        osVersion: body.osVersion,
      });
      return {
        success: true,
        message: "Push token registered",
        data: {
          device: {
            id: device.id,
            deviceId: device.deviceId,
            platform: device.platform,
            tokenUpdatedAt: device.tokenUpdatedAt,
            lastSeenAt: device.lastSeenAt,
          },
        },
      };
    },
    {
      body: t.Object({
        deviceId: t.String(),
        expoPushToken: t.String(),
        platform: t.Union([t.Literal("IOS"), t.Literal("ANDROID"), t.Literal("WEB")]),
        deviceName: t.Optional(t.String()),
        appVersion: t.Optional(t.String()),
        osVersion: t.Optional(t.String()),
      }),
    },
  )
  .get("/me/devices", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const devices = await devicePushService.listActive(userId);
    return {
      success: true,
      data: {
        devices: devices.map((d) => ({
          id: d.id,
          deviceId: d.deviceId,
          platform: d.platform,
          deviceName: d.deviceName,
          lastSeenAt: d.lastSeenAt,
          tokenUpdatedAt: d.tokenUpdatedAt,
        })),
      },
    };
  })
  .delete("/me/devices/:deviceId", async ({ requireAuth, params }) => {
    const { userId } = requireAuth();
    await devicePushService.revokeDevice(userId, params.deviceId);
    return { success: true, message: "Device push token revoked" };
  });

/** Backward-compatible alias for web app `/api/user/me` */
export const userRoutes = new Elysia()
  .use(usersApp)
  .group("/api/user", (app) =>
    app.use(authPlugin).get("/me", async ({ requireAuth }) => {
      const { userId } = requireAuth();
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phoneNumber: true,
          firstName: true,
          lastName: true,
          profileImage: true,
          role: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          isActive: true,
          isBanned: true,
          createdAt: true,
        },
      });
      if (!user) return { success: false, error: "User not found", code: "NOT_FOUND" };
      return { success: true, data: { user } };
    }),
  );

export { usersApp as usersRoutes };
