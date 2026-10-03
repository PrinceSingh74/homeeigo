/**
 * PHASE 9 - Capability 12, the admin integration contract.
 *
 * Structural tests over the navigation table, the route tree and the new components. They answer
 * questions a screenshot cannot: is every nav link real, did anything get duplicated, and does any
 * intelligence surface recompute a number the ledger already owns.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HQ_SECTIONS } from "../hq-navigation";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "app", "(console)");

/** Every route the app actually serves, derived from the file tree rather than a list. */
function routeTree(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    // Route groups like (console) do not appear in the URL.
    const segment = entry.startsWith("(") ? "" : `/${entry}`;
    const here = `${prefix}${segment}`;
    if (existsSync(join(full, "page.tsx"))) out.push(here === "" ? "/" : here);
    out.push(...routeTree(full, here));
  }
  return out;
}

let routes: string[] = [];
let navHrefs: string[] = [];
let briefSrc = "";
let scheduleSrc = "";
let reportsPageSrc = "";
let renderSrc = "";

beforeAll(async () => {
  routes = [...new Set(routeTree(APP))];
  if (existsSync(join(APP, "page.tsx"))) routes.push("/");
  routes = [...new Set(routes)];
  navHrefs = HQ_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
  briefSrc = await Bun.file(join(ROOT, "components", "hq", "ExecutiveIntelligenceBrief.tsx")).text();
  scheduleSrc = await Bun.file(join(ROOT, "components", "hq", "ScheduledReportStatus.tsx")).text();
  reportsPageSrc = await Bun.file(join(APP, "finance", "reports", "page.tsx")).text();
  renderSrc = await Bun.file(join(ROOT, "lib", "intelligence-render.ts")).text();
});

describe("navigation: no duplicates, no dead targets", () => {
  test("the route tree and the nav table were both read", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(navHrefs.length).toBeGreaterThan(40);
  });

  test("no nav href is listed twice", () => {
    const seen = new Map<string, number>();
    for (const h of navHrefs) seen.set(h, (seen.get(h) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([h]) => h);
    expect(dupes).toEqual([]);
  });

  test("every nav href resolves to a real page", () => {
    // Dynamic segments are served by a [param] directory; compare on the static prefix.
    const isServed = (href: string) =>
      routes.includes(href) || routes.some((r) => r.includes("[") && href.startsWith(r.split("[")[0]!.replace(/\/$/, "")));
    const dead = navHrefs.filter((h) => !isServed(h));
    expect(dead).toEqual([]);
  });

  /**
   * Capability 12 added no route. The intelligence surfaces mount inside pages that already existed,
   * which is what "integrate, do not create a parallel experience" means in practice.
   */
  test("no parallel v2 or -ai route was created", () => {
    for (const r of routes) {
      expect(/-v2$|-ai$|\/executive-v2|\/finance-ai|\/fraud-ai|\/approvals-v2|\/reports-v2/.test(r)).toBe(false);
    }
    expect(routes.includes("/intelligence")).toBe(false);
    expect(routes.includes("/executive-brief")).toBe(false);
  });

  test("the canonical surfaces the intelligence mounts into all still exist", () => {
    for (const r of ["/", "/finance/reports", "/ai-brain/approvals", "/digital-twin", "/fraud"]) {
      expect(routes).toContain(r);
    }
  });
});

/** Strips comments before asserting a string is absent — prose about a rule is not a violation of it. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, "");
}

describe("the UI consumes truth, it does not compute it", () => {
  test("no intelligence surface recalculates a ledger-owned figure", () => {
    const code = [briefSrc, scheduleSrc, reportsPageSrc].map(codeOnly).join("\n");
    // Arithmetic on money is the specific failure: a margin recomputed on the client is a second,
    // unreconciled source of truth for a board figure.
    for (const forbidden of [
      "gmv -", "gmv *", "gmv /", "netRevenue -", "netRevenue *", "netRevenue /",
      "* 100", "/ gmv", "parseFloat", "parseInt",
    ]) {
      expect(code.includes(forbidden)).toBe(false);
    }
  });

  test("a formatted string is never parsed back into a number", () => {
    const code = [briefSrc, scheduleSrc, reportsPageSrc].map(codeOnly).join("\n");
    // Word-boundary: `renderNumber(` is a guard, `Number(` is a coercion. The first is required
    // here and the second is the defect, so a substring match would have failed the wrong one.
    expect(/(?<![A-Za-z])Number\s*\(/.test(code)).toBe(false);
    expect(code.includes("parseFloat")).toBe(false);
    expect(code.includes("replace(/,/g")).toBe(false);
  });

  test("no fake zero fallback survives on the reports page", () => {
    const code = codeOnly(reportsPageSrc);
    expect(code.includes("?? 0")).toBe(false);
    expect(code.includes("|| 0")).toBe(false);
  });

  /**
   * One canonical request. Nine per-capability calls would rebuild the executive context nine times
   * per page load, which is the N+1 this capability is required to avoid.
   */
  test("the brief is fetched once, not per section", () => {
    const calls = [...codeOnly(briefSrc).matchAll(/adminApi\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(calls)]).toEqual(["executiveBrief"]);
    expect((codeOnly(briefSrc).match(/useQuery\(/g) ?? []).length).toBe(1);
  });

  test("the schedule panel makes exactly one request too", () => {
    const calls = [...codeOnly(scheduleSrc).matchAll(/adminApi\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(calls)]).toEqual(["reportScheduleStatus"]);
  });
});

describe("mandatory negative contracts", () => {
  test("a forecast is never labelled actual, and no simulation is rendered", () => {
    /**
     * Checked on what the panel *labels things*, not on whether the words appear anywhere: the
     * forecast hint deliberately contains both words in order to warn the reader, and an assertion
     * that banned the warning would be testing the opposite of the intent.
     */
    // Only the KIND_LABEL table — KIND_HINT sits directly below it and is the warning text itself.
    const block = briefSrc.slice(
      briefSrc.indexOf("const KIND_LABEL"),
      briefSrc.indexOf("const KIND_HINT"),
    );
    expect(block.length).toBeGreaterThan(100);
    const kindLabels = [...block.matchAll(/(FACT|ANOMALY|WARNING|FORECAST|RECOMMENDATION|LIMITATION): "([^"]+)"/g)]
      .map((m) => [m[1], m[2]] as [string, string]);
    expect(kindLabels.length).toBe(6);
    for (const [, label] of kindLabels) {
      expect(label.toLowerCase().includes("actual")).toBe(false);
      expect(label.toLowerCase().includes("simulat")).toBe(false);
    }

    // No twin simulation is fetched or rendered: the twin is city-scoped, the brief platform-scoped.
    const code = [briefSrc, scheduleSrc].map(codeOnly).join("\n");
    expect(code.includes("simulate")).toBe(false);
    expect(code.includes("scenario")).toBe(false);

    // And the forecast section states plainly what it is.
    expect(briefSrc.includes("Projections, not measurements")).toBe(true);
  });

  test("a fraud risk is never rendered as confirmed fraud", () => {
    const code = [briefSrc, scheduleSrc, reportsPageSrc].map(codeOnly).join("\n");
    for (const forbidden of ["CONFIRMED_FRAUD", "Confirmed fraud", "confirmed fraud", "Fraudster", "GUILTY"]) {
      expect(code.includes(forbidden)).toBe(false);
    }
  });

  test("a high-risk recommendation cannot be executed from a card", () => {
    const code = codeOnly(briefSrc);
    // No mutation of any kind is reachable from the brief: no mutation hook, no non-GET call,
    // no approve/execute affordance.
    for (const forbidden of [
      "useMutation", "adminApi.approve", "adminApi.execute", "method: \"POST\"",
      "onApprove", "onExecute", "executeTool", "consumeApproval",
    ]) {
      expect(code.includes(forbidden)).toBe(false);
    }
    // The panel says so to the reader as well, not only to the compiler.
    expect(briefSrc.includes("Nothing here executes")).toBe(true);
  });

  test("the schedule panel offers no way to set a schedule", () => {
    const code = codeOnly(scheduleSrc);
    for (const forbidden of ["useMutation", "onSave", "onSchedule", "<input", "<select", "type=\"submit\""]) {
      expect(code.includes(forbidden)).toBe(false);
    }
  });

  test("the required literal state is what the panel renders when nothing is configured", () => {
    expect(scheduleSrc.includes("Schedule not configured")).toBe(true);
    expect(scheduleSrc.includes("None scheduled")).toBe(true);
    expect(scheduleSrc.includes("Never run")).toBe(true);
  });

  test("known data-quality issues are stated on the page that produces the board PDF", () => {
    expect(reportsPageSrc.includes("Known data-quality issue")).toBe(true);
    expect(reportsPageSrc.includes("undefined when GMV is zero")).toBe(true);
    /**
     * And the warning names only defects that still exist. netRevenue's mixed-period issue was
     * repaired at the source, so a warning about it would train readers to ignore the box — the
     * failure mode of every stale alert.
     */
    const shown = reportsPageSrc.slice(reportsPageSrc.indexOf('role="note"'));
    expect(shown.includes("Net revenue</strong> subtracts")).toBe(false);
  });
});

describe("accessibility and layout contracts", () => {
  test("status is never conveyed by colour alone", () => {
    // Each status chip renders its own text; a screen reader receives the state, not a colour class.
    expect(briefSrc.includes("{item.state}")).toBe(true);
    /**
     * Both branches of the schedule chip render words. A chip that changed only its colour class
     * would leave a colour-blind reader — and every screen reader — with no status at all.
     */
    expect(scheduleSrc.includes("Schedule not configured")).toBe(true);
    expect(scheduleSrc.includes("Scheduled")).toBe(true);
    expect(scheduleSrc.includes('role="status"')).toBe(true);
  });

  test("wide content scrolls inside its own container, not the page", () => {
    expect(briefSrc.includes("overflow-x-auto")).toBe(true);
  });

  test("tables and sections are labelled", () => {
    expect(briefSrc.includes("<caption")).toBe(true);
    expect(briefSrc.includes('scope="col"')).toBe(true);
    expect(briefSrc.includes('scope="row"')).toBe(true);
    expect(briefSrc.includes("aria-labelledby")).toBe(true);
    expect(scheduleSrc.includes("aria-labelledby")).toBe(true);
  });

  test("the panels add no second H1", () => {
    for (const src of [briefSrc, scheduleSrc]) {
      expect(src.includes("<h1")).toBe(false);
    }
  });

  test("every intelligence surface handles loading, error and degraded explicitly", () => {
    for (const src of [briefSrc, scheduleSrc]) {
      expect(src.includes("isLoading")).toBe(true);
      expect(src.includes("isError")).toBe(true);
      expect(src.includes("DataUnavailable")).toBe(true);
      expect(src.includes("HqLoading")).toBe(true);
    }
  });
});

describe("no-vacuous-test guard", () => {
  test("every source under test was really loaded and is substantial", () => {
    expect(briefSrc.length).toBeGreaterThan(6_000);
    expect(scheduleSrc.length).toBeGreaterThan(3_000);
    expect(reportsPageSrc.length).toBeGreaterThan(3_000);
    expect(renderSrc.length).toBeGreaterThan(2_000);
    expect(briefSrc.includes("ExecutiveIntelligenceBrief")).toBe(true);
    expect(scheduleSrc.includes("ScheduledReportStatus")).toBe(true);
  });

  test("the comment stripper works, so absence claims are about code", () => {
    expect(codeOnly("/* Number( */ const a = 1;").includes("Number(")).toBe(false);
    expect(codeOnly("const a = Number(1);").includes("Number(")).toBe(true);
    // The brief's own prose mentions things its code must not do; stripping is what makes the
    // assertions meaningful rather than accidentally passing.
    expect(briefSrc.length).toBeGreaterThan(codeOnly(briefSrc).length);
  });
});
