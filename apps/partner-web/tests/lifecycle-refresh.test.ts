import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * X-82 (browser E2E, 2026-09-30): after "On my way" succeeded the job card kept offering "On my way" —
 * since X-73 the card follows the server's `/actions` answer (`["partner","job-actions",id]`, 15 s stale
 * time, no polling), and no lifecycle mutation refreshed it, so "I've arrived" never appeared. Every
 * mutation that changes a booking must refresh the actions answer together with the booking lists.
 */
const src = readFileSync(join(import.meta.dir, "..", "src", "hooks", "use-partner-data.ts"), "utf8");

function mutationBlocks(): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /export function (use\w+Mutation)\(/g;
  const starts = [...src.matchAll(re)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
    out.push({ name: m[1], body: src.slice(m.index!, end) });
  });
  return out;
}

describe("booking mutations refresh the job actions answer", () => {
  const touching = mutationBlocks().filter((b) => /invalidateQueries\(\{ queryKey: partnerKeys\.bookingsAll \}\)/.test(b.body));

  test("there are booking mutations to check", () => {
    expect(touching.map((b) => b.name)).toEqual(expect.arrayContaining(["useAcceptBookingMutation", "useMarkEnRouteMutation", "useMarkArrivedMutation", "useStartBookingMutation", "useCompleteBookingMutation"]));
  });

  test("each one also invalidates job-actions", () => {
    const missing = touching.filter((b) => !/invalidateQueries\(\{ queryKey: partnerKeys\.jobActionsAll \}\)/.test(b.body)).map((b) => b.name);
    expect(missing).toEqual([]);
  });
});
