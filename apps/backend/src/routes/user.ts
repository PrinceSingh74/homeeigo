import { Elysia } from "elysia";
import prisma from "../lib/prisma";
import { JWTService } from "../services/jwt.service";

const jwtService = new JWTService();

const requireUserId = (request: Request, set: { status?: number | string }) => {
  const header = request.headers.get("authorization");
  const payload = header ? jwtService.verifyAccessToken(header) : null;
  if (!payload?.userId) {
    set.status = 401;
    return null;
  }
  return payload.userId;
};

/** Authenticated user profile — matches guide `src/routes/user.ts` */
export const userRoutes = new Elysia({ prefix: "/api/user" }).get("/me", async ({ request, set }) => {
  const userId = requireUserId(request, set);
  if (!userId) {
    return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" as const };
  }
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
  if (!user) {
    set.status = 404;
    return { success: false, error: "User not found", code: "INVALID_INPUT" as const };
  }
  return { success: true, data: { user } };
});
