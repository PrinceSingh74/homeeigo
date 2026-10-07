/**
 * The HQ menu: every screen once, nothing that duplicates a tab, no promise a screen does not keep.
 * Each case below is an audit finding that must not come back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HQ_MENU, HQ_MENU_IDS, HQ_REDIRECTS, filterMenu, findMenuItem } from "../hq-menu.ts";

test("no screen is listed twice (Availability was in two sections)", () => {
  assert.equal(new Set(HQ_MENU_IDS).size, HQ_MENU_IDS.length);
  assert.equal(HQ_MENU_IDS.filter((id) => id === "account-availability").length, 1);
  const sectionIds = HQ_MENU.map((s) => s.id);
  assert.equal(new Set(sectionIds).size, sectionIds.length);
});

test("the dashboard and requests rows are gone; old links to them land on the tabs", () => {
  assert.equal(findMenuItem("dashboard"), null);
  assert.equal(findMenuItem("requests"), null);
  assert.equal(HQ_REDIRECTS.dashboard, "/(tabs)");
  assert.equal(HQ_REDIRECTS.requests, "/(tabs)/requests");
  for (const id of Object.keys(HQ_REDIRECTS)) assert.equal(HQ_MENU_IDS.includes(id), false);
});

test("the 'full ledger' row is gone: withdrawals are listed once, and the old link lands there", () => {
  assert.equal(findMenuItem("wallet-ledger"), null);
  assert.equal(HQ_REDIRECTS["wallet-ledger"], "/hq/earnings-payouts");
  assert.equal(findMenuItem("earnings-payouts")!.item.label, "Withdrawals");
  assert.equal(HQ_MENU.flatMap((s) => s.items).filter((i) => i.label === "Withdrawals").length, 1);
});

test("the only badge is 'Coming soon' — never a status the server did not send (the assistant's 'Live')", () => {
  const badged = HQ_MENU.flatMap((s) => s.items).filter((i) => i.badge !== undefined);
  assert.deepEqual(badged.map((i) => [i.id, i.badge]), [["territory-analytics", "Coming soon"]]);
  assert.equal(findMenuItem("ai-assistant")!.item.badge, undefined);
});

test("subtitles do not promise what the screens do not do", () => {
  const all = HQ_MENU.flatMap((s) => s.items).map((i) => i.subtitle.toLowerCase()).join(" | ");
  assert.equal(all.includes("turn-by-turn"), false);
  assert.equal(all.includes("interactive"), false);
  assert.equal(all.includes("live kpis"), false);
  assert.match(findMenuItem("territory-navigation")!.item.subtitle, /Google Maps/);
  assert.match(findMenuItem("territory-heatmap")!.item.subtitle, /list/i);
  assert.match(findMenuItem("account-map")!.item.subtitle, /open in Maps/);
});

test("labels and words the device scripts tap are unchanged", () => {
  const label = (id: string) => findMenuItem(id)!.item.label;
  assert.equal(label("account-availability"), "Availability");
  assert.equal(label("performance-scorecard"), "Scorecard");
  assert.equal(label("performance-career"), "Career");
  assert.equal(label("trust-compliance"), "Compliance");
  assert.equal(label("trust-documents"), "Documents");
  assert.equal(label("wellbeing-sos"), "SOS");
  assert.equal(label("rewards-referrals"), "Referrals");
  assert.equal(label("account-notifications"), "Notifications");
  assert.equal(label("ai-assistant"), "AI Assistant");
  assert.equal(label("ai-demand-forecast"), "Demand Forecast");
  assert.equal(label("ai-route"), "Route AI");
  assert.equal(label("ai-intelligence"), "Growth Advisor");
  assert.equal(label("territory-analytics"), "Territory Analytics");
  // e2e/native-android-section08-ai.ts finds the row by "Today, weekly, monthly".
  assert.ok(findMenuItem("earnings-forecast")!.item.subtitle.includes("Today, weekly, monthly"));
  // The weekly and monthly figures on that screen are what was earned, not projections.
  assert.doesNotMatch(findMenuItem("earnings-forecast")!.item.subtitle, /projection|forecast/i);
  // A script taps the first row whose text CONTAINS the word: no section title may contain one.
  for (const word of ["Compliance", "Documents", "Referrals", "Notifications", "Availability", "Scorecard", "Career"]) {
    for (const s of HQ_MENU) assert.equal(s.label.includes(word), false, `${s.label} contains ${word}`);
  }
});

test("every item has a label, a subtitle and an id that is a route segment", () => {
  for (const s of HQ_MENU) {
    assert.ok(s.items.length > 0, s.id);
    for (const i of s.items) {
      assert.match(i.id, /^[a-z][a-z0-9-]+$/);
      assert.ok(i.label.trim().length > 1);
      assert.ok(i.subtitle.trim().length > 8, i.id);
    }
  }
});

test("search narrows by label or subtitle and drops empty sections", () => {
  assert.equal(filterMenu("").length, HQ_MENU.length);
  const hits = filterMenu("withdraw");
  assert.deepEqual(hits.map((s) => s.id), ["earnings"]);
  assert.ok(hits[0]!.items.some((i) => i.id === "earnings-payouts"));
  assert.deepEqual(filterMenu("zzzz"), []);
});
