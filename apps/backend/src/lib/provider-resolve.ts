import prisma from "./prisma";

/** Resolve Provider.id from the vendor User.id (WebSocket / live flows). */
export async function resolveProviderIdFromUserId(userId: string): Promise<string | null> {
  const provider = await prisma.provider.findUnique({
    where: { userId },
    select: { id: true },
  });
  return provider?.id ?? null;
}
