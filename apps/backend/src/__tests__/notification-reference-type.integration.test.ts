import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { notificationService } from "../services/notification.service";
import { pushDeliveryService } from "../services/push-delivery.service";

/**
 * A notice about a booking must say so wherever a client reads it.
 *
 * An admin reschedule is announced as type "SYSTEM" with `referenceId` = the booking id and
 * `referenceType` = "booking". The row stored it, the WebSocket envelope carried it, but the list
 * and the push payload did not — so the partner app could not tell the id was a booking, and a tap
 * on the notice opened the jobs list instead of the job.
 */
const RUN = `nrt-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
const spies: Array<{ mockRestore: () => void }> = [];

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 60_000);
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});
afterAll(async () => {
  if (!reachable) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("a notification carries what its reference is", () => {
  it("the list and the push payload both carry referenceType", async () => {
    if (!reachable) return;
    const pushed: Array<{ data?: Record<string, unknown> }> = [];
    const push = spyOn(pushDeliveryService, "sendToUser").mockImplementation((async (_userId: string, payload: { data?: Record<string, unknown> }) => {
      pushed.push(payload);
      return undefined as never;
    }) as never);
    spies.push(push);

    const referenceId = `booking-${RUN}`;
    await notificationService.createForUser({
      userId: ctx.customerA.id,
      type: "SYSTEM",
      title: "Your visit was rescheduled",
      message: "An admin moved this job to a new time.",
      referenceId,
      referenceType: "booking",
    });

    const listed = await notificationService.list(ctx.customerA.id, { page: 1, limit: 20 });
    const row = listed.notifications.find((n) => n.referenceId === referenceId);
    expect(row).toBeDefined();
    expect((row as { referenceType?: string | null }).referenceType).toBe("booking");

    const sent = pushed.find((p) => p.data?.referenceId === referenceId);
    expect(sent).toBeDefined();
    expect(sent!.data!.referenceType).toBe("booking");
  });
});
