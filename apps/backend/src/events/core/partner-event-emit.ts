import prisma from "../../lib/prisma";
import { eventPlatformConfig } from "./config";
import { emitInTransaction, emitStandalone } from "./event-publisher";
import type { HomigoEvent } from "./homigo-event";
import type { Prisma } from "@prisma/client";

/** Emit a partner domain event when the platform flag allows it. */
export async function emitPartnerEvent(
  event: HomigoEvent,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.partnerEventsEnabled) return;
  if (tx) {
    await emitInTransaction(tx, event);
  } else {
    await emitStandalone(prisma, event);
  }
}
