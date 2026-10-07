/**
 * Where a tapped notification lands. A notification that names a booking opens that job; the rest
 * keep their existing targets. `referenceId` is a booking id only on booking notifications — the
 * server also puts document ids and withdrawal ids in it (compliance-expiry, earnings).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationBookingId, resolveNotificationHref } from "../notification-routing.ts";

test("a notification that carries a bookingId opens that job", () => {
  for (const type of ["BOOKING_REQUEST", "BOOKING_ACCEPTED", "BOOKING_CANCELLED", "CHAT_MESSAGE", "SYSTEM", undefined]) {
    assert.equal(resolveNotificationHref({ type, bookingId: "b-123" }), "/job/b-123", String(type));
  }
});

test("payment and rating land on the same screen from a push and from the in-app row", () => {
  // Push `data` as the server builds it (notification.service.ts notifyPaymentReceived / notifyRatingReceived).
  const paymentPush = { type: "PAYMENT_RECEIVED", referenceId: "b-1", bookingId: "b-1", amount: 500 };
  const ratingPush = { type: "RATING_RECEIVED", referenceId: "b-1", bookingId: "b-1", rating: 5, reviewerName: "Asha" };
  // The same notifications as rows of GET /api/notifications (no bookingId key).
  const paymentRow = { id: "n-1", type: "PAYMENT_RECEIVED", referenceId: "b-1", title: "Payment Received", message: "", isRead: false };
  const ratingRow = { id: "n-2", type: "RATING_RECEIVED", referenceId: "b-1", title: "New Rating", message: "", isRead: false };

  assert.equal(resolveNotificationHref(paymentPush), "/hq/earnings-hq");
  assert.equal(resolveNotificationHref(paymentRow), resolveNotificationHref(paymentPush));
  assert.equal(resolveNotificationHref(ratingPush), "/hq/performance-reviews");
  assert.equal(resolveNotificationHref(ratingRow), resolveNotificationHref(ratingPush));
  // Neither is "about a job" for the row's hint, even though the push names a booking.
  assert.equal(notificationBookingId(paymentPush), null);
  assert.equal(notificationBookingId(ratingPush), null);
});

test("referenceType \"booking\" makes referenceId a booking id on any type (an admin reschedule arrives as SYSTEM)", () => {
  // The server stores referenceType but does not send it on the list or in push data yet; when it
  // does, the notice opens its job. Without it the app cannot know what a SYSTEM referenceId is.
  assert.equal(resolveNotificationHref({ type: "SYSTEM", referenceId: "b-7", referenceType: "booking" }), "/job/b-7");
  assert.equal(resolveNotificationHref({ type: "SYSTEM", referenceId: "b-7", referenceType: "BOOKING" }), "/job/b-7");
  assert.equal(resolveNotificationHref({ type: "SYSTEM", referenceId: "b-7" }), "/(tabs)/requests");
  assert.equal(resolveNotificationHref({ type: "SYSTEM", referenceId: "wd-7", referenceType: "withdrawal" }), "/(tabs)/requests");
  // A stated non-booking reference wins over a booking-looking type.
  assert.equal(notificationBookingId({ type: "BOOKING_SOMETHING", referenceId: "x-1", referenceType: "document" }), null);
});

test("a booking notification's referenceId is its booking (in-app rows carry no bookingId key)", () => {
  assert.equal(resolveNotificationHref({ type: "BOOKING_ACCEPTED", referenceId: "b-9" }), "/job/b-9");
  assert.equal(resolveNotificationHref({ type: "booking_completion_auto_confirmed", referenceId: "b-9" }), "/job/b-9");
  assert.equal(notificationBookingId({ type: "BOOKING_REQUEST", referenceId: "b-9" }), "b-9");
});

test("a referenceId on any other type is NOT treated as a booking", () => {
  assert.equal(notificationBookingId({ type: "DOCUMENT_EXPIRING", referenceId: "doc-1" }), null);
  assert.equal(resolveNotificationHref({ type: "PAYMENT_RECEIVED", referenceId: "wd-1" }), "/hq/earnings-hq");
  assert.equal(resolveNotificationHref({ type: "RATING_RECEIVED", referenceId: "r-1" }), "/hq/performance-reviews");
});

test("the id is URL-encoded and blank ids are ignored", () => {
  assert.equal(resolveNotificationHref({ type: "BOOKING_STARTED", bookingId: "a/b c" }), "/job/a%2Fb%20c");
  assert.equal(resolveNotificationHref({ type: "BOOKING_REQUEST", bookingId: "  " }), "/(tabs)/requests");
  assert.equal(resolveNotificationHref({ type: "BOOKING_REQUEST", bookingId: 42 }), "/(tabs)/requests");
});

test("existing targets are kept for notifications that name no booking", () => {
  assert.equal(resolveNotificationHref({ type: "BOOKING_REQUEST" }), "/(tabs)/requests");
  assert.equal(resolveNotificationHref({ type: "BOOKING_ACCEPTED" }), "/(tabs)/requests");
  assert.equal(resolveNotificationHref({ type: "PAYMENT_RECEIVED" }), "/hq/earnings-hq");
  assert.equal(resolveNotificationHref({ type: "RATING_RECEIVED" }), "/hq/performance-reviews");
  assert.equal(resolveNotificationHref({ type: "SOMETHING_NEW" }), "/(tabs)/requests");
  assert.equal(resolveNotificationHref({}), "/(tabs)/requests");
  assert.equal(resolveNotificationHref(undefined), "/(tabs)/requests");
});
