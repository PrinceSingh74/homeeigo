/**
 * The four publish flags of a service that is on sale, for a FIXTURE inserted straight into the
 * test database.
 *
 * A new `services` row is a draft by default (migration 20261006190000_service_defaults_draft): a
 * service reaches customers through the admin flow — review, a second admin's approval, the publish
 * gate. A suite that needs a bookable service to exercise something else (payments, matching,
 * refunds) spreads this into its `prisma.service.create` instead of walking that flow each time.
 * Test database only; nothing outside `__tests__` and local seed scripts may use it.
 */
export const LIVE_FIXTURE_SERVICE = {
  isActive: true,
  lifecycleStatus: "ACTIVE",
  isCustomerVisible: true,
  isBookable: true,
} as const;
