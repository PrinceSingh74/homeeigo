import prisma from "../../../lib/prisma";

export async function collectSupportContext(actorId?: string): Promise<Record<string, unknown>> {
  const since24h = new Date(Date.now() - 86_400_000);

  const [openTickets, inProgress, resolved24h, highPriority, recentTickets] = await Promise.all([
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
    prisma.supportTicket.count({ where: { status: "IN_PROGRESS" } }),
    prisma.supportTicket.count({
      where: { status: { in: ["RESOLVED", "CLOSED"] }, resolvedAt: { gte: since24h } },
    }).catch(() => 0),
    prisma.supportTicket.count({ where: { priority: "high", status: { in: ["OPEN", "IN_PROGRESS"] } } }).catch(() => 0),
    prisma.supportTicket.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        category: true,
        priority: true,
        status: true,
        userId: true,
        createdAt: true,
      },
    }),
  ]);

  let agentTickets: unknown[] = [];
  if (actorId) {
    agentTickets = await prisma.supportTicket.findMany({
      where: { userId: actorId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      take: 5,
      select: { id: true, ticketNumber: true, subject: true, status: true, priority: true },
    });
  }

  return {
    queue: { open: openTickets, inProgress, resolved24h, highPriority },
    recentTickets,
    agentTickets,
    customerIssues: recentTickets.filter((t) => t.status === "OPEN").length,
  };
}
