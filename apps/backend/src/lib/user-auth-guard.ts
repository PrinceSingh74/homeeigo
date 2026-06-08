import prisma from "./prisma";

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
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, isBanned: true, isActive: true, deletedAt: true, deletionScheduledAt: true },
  });
  if (!user) return null;
  if (user.deletedAt || !user.isActive || user.isBanned || user.deletionScheduledAt) {
    throw new Error("ACCOUNT_SUSPENDED");
  }
  return user;
}
