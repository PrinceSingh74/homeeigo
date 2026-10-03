import "../src/load-env";
import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { redisClient } from "../src/lib/redis";
import { bookingPriorityService } from "../src/services/booking-priority.service";

async function main() {
  const token = randomUUID();
  const acquired = await redisClient.acquireLock("assignment:processor", token, 25);
  console.log("Lock acquired by this process:", acquired);
  if (acquired) {
    await redisClient.releaseLock("assignment:processor", token);
    console.log("(released immediately, was just testing)");
  }

  const queue = await bookingPriorityService.getAssignmentQueue(10);
  console.log("\ngetAssignmentQueue(10) returned:", queue.length, "items");
  console.log(JSON.stringify(queue.slice(0, 3), null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
