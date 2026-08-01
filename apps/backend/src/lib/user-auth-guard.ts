import prisma from "./prisma";
import { userPiiService } from "../services/user-pii.service";

export async function assertUserMayAuthenticate(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isBanned: true, isActive: true, deletedAt: true, deletionScheduledAt: true },
  });
  if (!user || user.deletedAt || !user.isActive || user.isBanned || user.deletionScheduledAt) {
    throw new Error("ACCOUNT_SUSPENDED");
  }
  return user;
}

export async function assertUserMayAuthenticateByEmail(email: string) {
  const user = await userPiiService.findByEmail(email);
  if (!user) return null;
  const guardUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, isBanned: true, isActive: true, deletedAt: true, deletionScheduledAt: true },
  });
  if (!guardUser) return null;
  if (guardUser.deletedAt || !guardUser.isActive || guardUser.isBanned || guardUser.deletionScheduledAt) {
    throw new Error("ACCOUNT_SUSPENDED");
  }
  return guardUser;
}
