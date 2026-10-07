/**
 * The customer's view of what their booking is (option, quantity, add-on units), read from the
 * booking's own frozen columns. Composed onto GET /api/bookings/:id for the customer only; the
 * partner payload carries the same projection as `job`.
 */
import prisma from "../lib/prisma";
import { customerSelectionSummary, type CustomerSelectionSummary } from "../lib/customer-selection-summary";

export const bookingSelectionSummaryService = {
  /** Null when the booking is not the customer's (the route has already answered 404 by then). */
  async forCustomer(bookingId: string, userId: string): Promise<CustomerSelectionSummary | null> {
    const b = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      select: { serviceSelection: true, addons: true, estimatedDuration: true },
    });
    if (!b) return null;
    return customerSelectionSummary(b.serviceSelection, b.addons, b.estimatedDuration);
  },
};
