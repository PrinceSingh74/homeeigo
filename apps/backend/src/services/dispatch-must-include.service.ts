import prisma from "../lib/prisma";
import { DISPATCH_LIFECYCLE_WHERE } from "../lib/partner-four-axis";
import { mustIncludePhonesForEmail } from "../lib/dispatch-must-include";
import { logger } from "../lib/logger";
import { userPiiService } from "./user-pii.service";

type CustomerEmailFields = Parameters<typeof userPiiService.resolveEmail>[0] & { id: string };

/**
 * Resolve pinned partner provider IDs for this customer. Empty when the
 * customer is not pinned, or the partner is missing / not lifecycle ACTIVE.
 */
export async function resolveMustIncludeProviderIds(user: CustomerEmailFields): Promise<string[]> {
  const email = await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true });
  if (!email) return [];
  const phones = mustIncludePhonesForEmail(email);
  if (phones.length === 0) return [];

  const ids: string[] = [];
  for (const phone of phones) {
    const partnerUser = await userPiiService.findByPhone(phone);
    if (!partnerUser) continue;
    const provider = await prisma.provider.findFirst({
      where: {
        userId: partnerUser.id,
        isActive: true,
        isApproved: true,
        isBanned: false,
        complianceRestricted: false,
        ...DISPATCH_LIFECYCLE_WHERE,
      },
      select: { id: true },
    });
    if (provider) ids.push(provider.id);
  }

  if (ids.length > 0) {
    logger.info("dispatch_must_include_resolved", { userId: user.id, providerCount: ids.length });
  }
  return ids;
}

export async function isMustIncludePinnedProvider(
  customer: CustomerEmailFields | null | undefined,
  providerId: string,
): Promise<boolean> {
  if (!customer) return false;
  const ids = await resolveMustIncludeProviderIds(customer);
  return ids.includes(providerId);
}
