import type { AiGatewayRole } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { AiGatewayContext, AiMessage } from "../types";

export type BuiltContext = {
  systemContext: string;
  messages: AiMessage[];
  metadata: Record<string, unknown>;
};

export async function buildConversationContext(history?: AiMessage[]): Promise<AiMessage[]> {
  if (!history?.length) return [];
  return history.slice(-20);
}

export async function buildBookingContext(bookingId?: string): Promise<string> {
  if (!bookingId) return "";
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      service: { select: { name: true, category: true } },
      address: { select: { city: true, pincode: true } },
    },
  });
  if (!booking) return "";
  return [
    `Booking ${booking.id}`,
    `Status: ${booking.status}`,
    `Service: ${booking.service?.name ?? "unknown"} (${booking.service?.category ?? ""})`,
    `City: ${booking.address?.city ?? "unknown"}`,
    `Scheduled: ${booking.scheduledDate?.toISOString() ?? "ASAP"}`,
  ].join("\n");
}

export async function buildPartnerContext(partnerId?: string): Promise<string> {
  if (!partnerId) return "";
  const provider = await prisma.provider.findUnique({
    where: { id: partnerId },
    select: {
      id: true,
      businessName: true,
      rating: true,
      totalBookings: true,
      isOnline: true,
      serviceRegions: true,
    },
  });
  if (!provider) return "";
  return [
    `Partner ${provider.id}`,
    `Business: ${provider.businessName ?? "unknown"}`,
    `Rating: ${provider.rating ?? 0}`,
    `Total bookings: ${provider.totalBookings ?? 0}`,
    `Online: ${provider.isOnline}`,
    `Regions: ${provider.serviceRegions?.join(", ") ?? "unknown"}`,
  ].join("\n");
}

export async function buildCustomerContext(customerId?: string): Promise<string> {
  if (!customerId) return "";
  const user = await prisma.user.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      firstName: true,
      _count: { select: { bookings: true } },
    },
  });
  if (!user) return "";
  return [
    `Customer ${user.id}`,
    `Name: ${user.firstName ?? "Guest"}`,
    `Bookings: ${user._count.bookings}`,
  ].join("\n");
}

export function buildLocationContext(location?: AiGatewayContext["location"]): string {
  if (!location) return "";
  return `Location: lat=${location.lat}, lng=${location.lng}${location.city ? `, city=${location.city}` : ""}`;
}

export async function buildAiContext(
  role: AiGatewayRole,
  message: string,
  context?: AiGatewayContext,
  history?: AiMessage[],
): Promise<BuiltContext> {
  const sections: string[] = [`Role: ${role}`];
  const customerId = context?.customerId ?? context?.userId;
  const [bookingCtx, partnerCtx, customerCtx] = await Promise.all([
    buildBookingContext(context?.bookingId),
    buildPartnerContext(context?.partnerId),
    buildCustomerContext(customerId),
  ]);

  if (bookingCtx) sections.push("--- Booking ---", bookingCtx);
  if (partnerCtx) sections.push("--- Partner ---", partnerCtx);
  if (customerCtx) sections.push("--- Customer ---", customerCtx);
  sections.push(buildLocationContext(context?.location));

  const historyMessages = await buildConversationContext(history);
  const contextBlock = sections.filter(Boolean).join("\n");

  return {
    systemContext: contextBlock,
    messages: [
      ...historyMessages,
      { role: "user", content: message },
    ],
    metadata: {
      role,
      hasBooking: Boolean(context?.bookingId),
      hasPartner: Boolean(context?.partnerId),
      hasCustomer: Boolean(customerId),
      ...(context?.metadata ?? {}),
    },
  };
}
