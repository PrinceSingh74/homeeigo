import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Fail on serious/critical WCAG 2.0 A/AA issues. Moderate findings are logged. */
export async function assertAxeSerious(
  page: Page,
  context: string,
  opts?: { exclude?: string[]; include?: string[] },
) {
  // The partner sidebar fades in on every navigation (CSS opacity transition): an axe pass inside it
  // measured its white-on-blue buttons at 3.7:1 through the fade instead of their resting ~6.7:1.
  // Wait until every FINITE animation/transition has finished — infinite ones (spinners, live
  // pulses) never end and are not a render in progress.
  await page.waitForFunction(
    () =>
      document.getAnimations().every((a) => {
        if (a.playState !== "running") return true;
        const end = a.effect?.getComputedTiming().endTime;
        return typeof end === "number" && !Number.isFinite(end);
      }),
    undefined,
    { timeout: 10_000 },
  );
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  for (const sel of opts?.exclude ?? []) builder = builder.exclude(sel);
  for (const sel of opts?.include ?? []) builder = builder.include(sel);
  const results = await builder.analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => n.target),
  }));
  expect(blocking, `${context}\n${JSON.stringify(summary, null, 2)}`).toEqual([]);
}
