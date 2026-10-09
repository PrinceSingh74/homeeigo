import prisma from "../../lib/prisma";
import { processOutboxBatch } from "../../events/core/outbox-processor";

/**
 * Drains a suite's own outbox rows through the real processor.
 *
 * Other suites leave PENDING rows behind and the processor claims oldest first, so a suite's events
 * can sit behind thousands of foreign ones and a bounded drain never reaches them. Every PENDING
 * row created before the suite started is parked (ids remembered) and `restore()` puts each one
 * back exactly — nothing is published or deleted on another suite's behalf.
 */
export function outboxDrainer() {
  const parked = new Set<string>();
  let suiteStartedAt = new Date();

  async function park(): Promise<void> {
    const foreign = await prisma.eventOutbox.findMany({
      where: { status: "PENDING", createdAt: { lt: suiteStartedAt }, availableAt: { lt: new Date(Date.now() + 86_400_000) } },
      select: { id: true },
    });
    if (foreign.length === 0) return;
    for (const f of foreign) parked.add(f.id);
    await prisma.$executeRaw`UPDATE event_outbox SET available_at = available_at + interval '100 years' WHERE id = ANY(${foreign.map((f) => f.id)})`;
  }

  return {
    /** Call from beforeAll: rows created before this belong to other suites. */
    begin(): void {
      suiteStartedAt = new Date();
    },
    async drain(): Promise<{ recovered: number }> {
      await park();
      let recovered = 0;
      for (let i = 0; i < 8; i++) {
        const out = await processOutboxBatch();
        recovered += out.recovered;
        if (out.claimed === 0) break;
      }
      return { recovered };
    },
    async restore(): Promise<void> {
      if (parked.size === 0) return;
      await prisma.$executeRaw`UPDATE event_outbox SET available_at = available_at - interval '100 years' WHERE id = ANY(${[...parked]})`;
      parked.clear();
    },
  };
}
