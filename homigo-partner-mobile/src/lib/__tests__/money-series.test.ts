/**
 * Shaping the server's series for drawing: bar proportions only. No total, average or "best day"
 * is derived on the device.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { earningsChart, pageOf, ratingBreakdownRows } from "../money-series.ts";

test("earningsChart: one bar per day the server sent, scaled to the largest day", () => {
  const chart = earningsChart([
    { date: "2026-10-01", amount: 0 },
    { date: "2026-10-02", amount: 500 },
    { date: "2026-10-03", amount: 1000 },
  ]);
  assert.equal(chart.max, 1000);
  assert.equal(chart.hasEarnings, true);
  assert.deepEqual(chart.bars.map((b) => b.ratio), [0, 0.5, 1]);
  assert.deepEqual(chart.bars.map((b) => b.date), ["2026-10-01", "2026-10-02", "2026-10-03"]);
});

test("earningsChart: a period with nothing earned has no chart to draw", () => {
  const chart = earningsChart([{ date: "2026-10-01", amount: 0 }, { date: "2026-10-02", amount: 0 }]);
  assert.equal(chart.hasEarnings, false);
  assert.equal(chart.max, 0);
  assert.deepEqual(chart.bars.map((b) => b.ratio), [0, 0]);
});

test("earningsChart: a missing series, a negative day and an unreadable amount never break the scale", () => {
  assert.deepEqual(earningsChart(null), { bars: [], max: 0, hasEarnings: false });
  assert.deepEqual(earningsChart(undefined).bars, []);
  const chart = earningsChart([
    { date: "2026-10-01", amount: -40 },
    { date: "2026-10-02", amount: Number.NaN },
    { date: "2026-10-03", amount: 200 },
  ]);
  assert.equal(chart.max, 200);
  assert.deepEqual(chart.bars.map((b) => b.ratio), [0, 0, 1]);
  assert.equal(chart.bars[0]?.amount, -40, "the amount itself is kept as sent");
});

test("ratingBreakdownRows: five rows, top star first, with the server's counts", () => {
  const rows = ratingBreakdownRows({ "5": 8, "4": 4, "3": 0, "2": 1, "1": 0 });
  assert.deepEqual(rows.map((r) => r.stars), [5, 4, 3, 2, 1]);
  assert.deepEqual(rows.map((r) => r.count), [8, 4, 0, 1, 0]);
  assert.deepEqual(rows.map((r) => r.ratio), [1, 0.5, 0, 0.125, 0]);
});

test("ratingBreakdownRows: no reviews, or no breakdown at all, is five empty rows", () => {
  const inputs: Array<Record<string, number> | null | undefined> = [null, undefined, {}, { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 }];
  for (const input of inputs) {
    const rows = ratingBreakdownRows(input);
    assert.equal(rows.length, 5);
    assert.equal(rows.every((r) => r.count === 0 && r.ratio === 0), true);
  }
});

test("pageOf: what is shown and how many more are held back", () => {
  assert.deepEqual(pageOf([1, 2, 3, 4, 5], 3), { visible: [1, 2, 3], hidden: 2 });
  assert.deepEqual(pageOf([1, 2], 10), { visible: [1, 2], hidden: 0 });
  assert.deepEqual(pageOf(null, 5), { visible: [], hidden: 0 });
});
