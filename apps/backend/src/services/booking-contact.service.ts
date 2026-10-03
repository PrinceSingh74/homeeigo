import prisma from "../lib/prisma";
import { maskPhone, maskPhoneForPartner, normalizePhone } from "../lib/pii-normalize";
import { userPiiService } from "./user-pii.service";

const CALLABLE_STATUSES = new Set(["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"]);

/**
 * X-28 — owner decision 2026-09-29 (privacy first): a partner never receives the customer's full phone
 * number. Partner → customer calls need a masked-call relay; none exists, so direct calling is withheld
 * and the partner is pointed at in-app chat. Flip only when a relay returns a relay number instead.
 */
export const PARTNER_CALL_RELAY_AVAILABLE = false;

class BookingContactService {
  private async loadForProvider(bookingId: string, providerId: string) {
    return prisma.booking.findFirst({
      where: { id: bookingId, providerId },
      select: {
        id: true,
        status: true,
        userId: true,
        providerId: true,
        user: {
          select: {
            id: true,
            phoneNumber: true,
            phoneEncrypted: true,
          },
        },
      },
    });
  }

  private async loadForCustomer(bookingId: string, userId: string) {
    return prisma.booking.findFirst({
      where: { id: bookingId, userId },
      select: {
        id: true,
        status: true,
        userId: true,
        providerId: true,
        provider: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                phoneNumber: true,
                phoneEncrypted: true,
              },
            },
          },
        },
      },
    });
  }

  private async resolveUserPhone(
    user: { id: string; phoneNumber: string | null; phoneEncrypted: string | null },
    actorId: string,
  ): Promise<string | null> {
    const raw =
      (await userPiiService.resolvePhone(user, { actorId, authorized: true })) ||
      user.phoneNumber;
    if (!raw) return null;
    const normalized = normalizePhone(raw);
    if (!/^\+?\d[\d\s-]{6,}$/.test(normalized)) return null;
    return normalized;
  }

  async getMaskedContact(bookingId: string, providerId: string) {
    const booking = await this.loadForProvider(bookingId, providerId);
    if (!booking) throw new Error("NOT_FOUND");

    const phone = await this.resolveUserPhone(booking.user, providerId);
    const canCall = PARTNER_CALL_RELAY_AVAILABLE && CALLABLE_STATUSES.has(booking.status) && Boolean(phone);
    return {
      phoneMasked: phone ? maskPhoneForPartner(phone) : null,
      canCall,
      ...(PARTNER_CALL_RELAY_AVAILABLE ? {} : { callUnavailableReason: "CALL_RELAY_UNAVAILABLE" as const, alternative: "CHAT" as const }),
    };
  }

  /**
   * X-28: withheld while no masked-call relay exists — the partner gets NO number (not even inside a
   * tel: URI) and is sent to in-app chat. The attempt is recorded, without the number.
   */
  async initiateCall(bookingId: string, providerId: string, actorUserId: string) {
    const booking = await this.loadForProvider(bookingId, providerId);
    if (!booking) throw new Error("NOT_FOUND");
    if (!CALLABLE_STATUSES.has(booking.status)) throw new Error("INVALID_STATUS");
    // A relay integration, when one exists, returns a RELAY number here — never the customer's own.
    await prisma.activityLog.create({
      data: { bookingId, userId: actorUserId, providerId, action: "CUSTOMER_CALL_WITHHELD", description: "Direct call withheld: no masked-call relay; partner pointed to in-app chat" },
    });
    throw new Error("CALL_RELAY_UNAVAILABLE");
  }

  /** Customer → partner: masked only; never return raw partner phone in list/detail payloads. */
  async getPartnerMaskedContact(bookingId: string, customerUserId: string) {
    const booking = await this.loadForCustomer(bookingId, customerUserId);
    if (!booking?.provider?.user) throw new Error("NOT_FOUND");

    const phone = await this.resolveUserPhone(booking.provider.user, customerUserId);
    const canCall = CALLABLE_STATUSES.has(booking.status) && Boolean(phone);
    return {
      phoneMasked: phone ? maskPhoneForPartner(phone) : null,
      canCall,
    };
  }

  async initiatePartnerCall(bookingId: string, customerUserId: string) {
    const booking = await this.loadForCustomer(bookingId, customerUserId);
    if (!booking?.provider?.user) throw new Error("NOT_FOUND");
    if (!CALLABLE_STATUSES.has(booking.status)) throw new Error("INVALID_STATUS");

    const phone = await this.resolveUserPhone(booking.provider.user, customerUserId);
    if (!phone) throw new Error("NO_PHONE");

    const e164 = normalizePhone(phone);
    await prisma.activityLog.create({
      data: {
        bookingId,
        userId: customerUserId,
        providerId: booking.providerId,
        action: "PARTNER_CALL_INITIATED",
        description: `Controlled customer→partner call initiated to ${maskPhone(e164)}`,
      },
    });

    return {
      dialUri: `tel:${e164}`,
      phoneMasked: maskPhoneForPartner(e164),
      expiresInSec: 60,
    };
  }
}

export const bookingContactService = new BookingContactService();
