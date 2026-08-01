/** Backpressure verify — env must be set before config module loads. */
process.env.EVENTS_CONSUMER_CONCURRENCY = "2";
process.env.EVENTS_CONSUMERS_ENABLED = "true";

import { buildBookingCreatedEvent } from "../src/events/catalog/booking.events";
import { clearConsumersForTests, registerConsumer } from "../src/events/core/consumer-registry";
import { eventPlatformConfig } from "../src/events/core/config";

const { dispatchEvent } = await import("../src/events/core/event-bus");

let peak = 0;
let active = 0;

clearConsumersForTests();
for (let i = 0; i < 6; i++) {
  registerConsumer({
    name: `bp.slow.${i}`,
    eventTypes: ["homigo.booking.created"],
    handler: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 100));
      active -= 1;
    },
    maxAttempts: 1,
  });
}

const event = buildBookingCreatedEvent({
  bookingId: `bp_${Date.now()}`,
  bookingNumber: "HG-BP",
  userId: "u",
  serviceId: "s",
  serviceCategory: "cleaning",
  city: "Delhi",
  providerId: null,
  status: "PENDING",
  finalAmount: 1,
  paymentMethod: "razorpay",
  scheduledAt: new Date(),
});

await dispatchEvent(event);

const limit = eventPlatformConfig.consumerConcurrency;
const pass = peak <= limit;
console.log(JSON.stringify({ peak, limit, pass: pass ? "PASS" : "FAIL" }));
process.exit(pass ? 0 : 1);
