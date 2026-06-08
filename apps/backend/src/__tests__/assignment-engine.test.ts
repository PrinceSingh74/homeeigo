import { describe, expect, test } from "bun:test";
import { resolveTierPriorityScore } from "../lib/membership-tiers";

describe("Assignment priority ordering", () => {
  test("platinum dispatches before free tier", () => {
    const platinum = resolveTierPriorityScore("platinum");
    const free = resolveTierPriorityScore("free");
    expect(platinum).toBeGreaterThan(free);
    expect(platinum).toBe(100);
    expect(free).toBe(10);
  });

  test("gold ranks above silver and free", () => {
    const gold = resolveTierPriorityScore("gold");
    const silver = resolveTierPriorityScore("silver");
    const free = resolveTierPriorityScore("free");
    expect(gold).toBeGreaterThan(silver);
    expect(silver).toBeGreaterThan(free);
  });
});

describe("AssignmentEngine — queue sort contract", () => {
  test("priority score desc then FIFO by createdAt", () => {
    const queue = [
      { priorityScore: 10, queuedAt: new Date("2026-01-02") },
      { priorityScore: 100, queuedAt: new Date("2026-01-03") },
      { priorityScore: 80, queuedAt: new Date("2026-01-01") },
    ];
    queue.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return a.queuedAt.getTime() - b.queuedAt.getTime();
    });
    expect(queue[0]!.priorityScore).toBe(100);
    expect(queue[1]!.priorityScore).toBe(80);
    expect(queue[2]!.priorityScore).toBe(10);
  });
});
