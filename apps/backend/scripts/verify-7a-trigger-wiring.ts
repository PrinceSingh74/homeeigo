import "../src/load-env";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { triggersFor } from "../src/automation/registry/trigger-registry";

async function main() {
  const triggers = triggersFor(EVENT_TYPES.BOOKING_COMPLETED);
  console.log(`Triggers registered for ${EVENT_TYPES.BOOKING_COMPLETED}:`);
  for (const t of triggers) {
    console.log(`  workflowId=${t.workflowId} subjectType=${t.subjectType}`);
  }

  const hasFollowUp = triggers.some((t) => t.workflowId === "follow_up");
  const hasReviewRequest = triggers.some((t) => t.workflowId === "review_request");
  console.log("\nfollow_up wired:", hasFollowUp);
  console.log("review_request still wired (must remain, unmodified):", hasReviewRequest);

  process.exit(hasFollowUp && hasReviewRequest ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
