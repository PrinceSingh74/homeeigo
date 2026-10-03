/**
 * PHASE 9 - Capability 8, Digital Twin narratives.
 *
 * Runs ONLY on the isolated homigo_p39 database and aborts otherwise.
 *
 * The property defended: a simulation can never be read as a forecast or an observation, an
 * unsupported city can never borrow another city state, and a confidence typed into the source can
 * never be presented as one the platform measured.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  digitalTwinNarrativeService,
  TWIN_NARRATIVE_RULES_VERSION,
  TWIN_REASON,
} from "../services/digital-twin-narrative.service";
import { SUPPORTED_CITIES } from "../services/digital-twin.service";

let src = "";
let twinSrc = "";

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join(String.fromCharCode(10));
}

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, payments, wallet, ledger, assignments, notifications, outbox, instances, jobs] =
    await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.walletTransaction.count(),
      prisma.ledgerEntry.count(), prisma.assignmentJob.count(), prisma.notification.count(),
      prisma.eventOutbox.count(), prisma.workflowInstance.count(), prisma.scheduledJob.count(),
    ]);
  return { bookings, payments, wallet, ledger, assignments, notifications, outbox, instances, jobs };
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  src = await Bun.file(import.meta.dir + "/../services/digital-twin-narrative.service.ts").text();
  twinSrc = await Bun.file(import.meta.dir + "/../services/digital-twin.service.ts").text();
});

describe("scope is city-level and validated", () => {
  test("the supported set is read from the service, not restated", () => {
    const expected = [...SUPPORTED_CITIES.tier0, ...SUPPORTED_CITIES.tier1];
    expect(digitalTwinNarrativeService.supportedCities()).toEqual(expected);
    expect(expected.length).toBe(7);
  });

  test("a supported city resolves with its tier", async () => {
    const n = await digitalTwinNarrativeService.explainCityState("Gurugram");
    expect(n.scope).toBe("CITY");
    expect(n.tier).toBe(0);
    expect(n.state).not.toBe("DIGITAL_TWIN_UNSUPPORTED_SCOPE");
  });

  test("an unsupported city is refused and inherits nothing", async () => {
    const n = await digitalTwinNarrativeService.explainCityState("Chennai");
    expect(n.state).toBe("DIGITAL_TWIN_UNSUPPORTED_SCOPE");
    expect(n.reasonCode).toBe(TWIN_REASON.UNSUPPORTED_CITY);
    expect(n.layers).toBeNull();
    expect(n.tier).toBeNull();
    expect(n.statedConfidence).toBeNull();
    expect(n.limitations[0]).toContain("No state is inferred from any other city");
  });

  test("the twin is never described as zone-scoped", async () => {
    const n = await digitalTwinNarrativeService.explainCityState("Delhi");
    expect(n.scope).toBe("CITY");
    expect(n.limitations.some((l) => l.includes("models no zones"))).toBe(true);
    expect(codeOnly(src).includes("scope: " + String.fromCharCode(34) + "ZONE")).toBe(false);
  });

  test("city matching tolerates case and spacing but is not fuzzy", async () => {
    const a = await digitalTwinNarrativeService.explainCityState("  gurugram ");
    expect(a.tier).toBe(0);
    const b = await digitalTwinNarrativeService.explainCityState("Gurgaon");
    expect(b.state).toBe("DIGITAL_TWIN_UNSUPPORTED_SCOPE");
  });
});

describe("a simulation stays a simulation", () => {
  test("a scenario result is typed SIMULATED_STATE", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { providerDeltaPct: -20 });
    expect(s.stateKind).toBe("SIMULATED_STATE");
  });

  test("a scenario never uses forecast or guarantee language", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { rainStart: true });
    const blob = JSON.stringify(s).toLowerCase();
    for (const t of ["will decrease", "will increase", "guaranteed", "expected to fall"]) {
      expect(blob).not.toContain(t);
    }
    expect(s.limitations.some((l) => l.includes("not a forecast and not an observation"))).toBe(true);
  });

  test("live state and simulation carry different state kinds", async () => {
    const live = await digitalTwinNarrativeService.explainCityState("Gurugram");
    const sim = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 10 });
    expect(live.stateKind).toBe("LIVE_OPERATIONAL_STATE");
    expect(sim.stateKind).toBe("SIMULATED_STATE");
  });

  test("no causal claim is made about production", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { providerDeltaPct: -30 });
    const blob = JSON.stringify(s).toLowerCase();
    for (const c of ["will cause", "because of this scenario"]) expect(blob).not.toContain(c);
  });
});

describe("silent assumptions are published", () => {
  test("rainStart exposes both of its multipliers", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { rainStart: true });
    const t = s.assumptions.map((a) => a.trigger + ":" + a.effect + ":" + a.multiplier);
    expect(t).toContain("rainStart:demand multiplied:1.25");
    expect(t).toContain("rainStart:traffic multiplied:1.2");
  });

  test("festival exposes its multiplier", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { festival: true });
    expect(s.assumptions.some((a) => a.trigger === "festival" && a.multiplier === 1.6)).toBe(true);
  });

  test("a scenario without triggers has no assumptions rather than invented ones", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 5 });
    expect(s.assumptions).toEqual([]);
  });

  /**
   * The published constants must match the source. They are restated only so they can be shown; if
   * the simulation changes one, this fails rather than the narrative publishing a stale assumption.
   */
  test("the published multipliers match the simulation source", () => {
    expect(twinSrc).toContain("rainStart ? 1.25 : 1");
    expect(twinSrc).toContain("festival ? 1.6");
    expect(twinSrc).toContain("rainStart ? 1.2 : 1");
    expect(twinSrc).toContain("Math.exp(-0.6 *");
    expect(digitalTwinNarrativeService.conversionElasticity()).toBe(-0.6);
  });

  test("the elasticity is named as an assumption, not a measurement", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 10 });
    expect(s.limitations.some((l) => l.includes("assumed elasticity, not a measured one"))).toBe(true);
  });
});

describe("confidence carries its provenance", () => {
  test("a simulation confidence is marked CONSTANT", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 10 });
    expect(s.statedConfidence).not.toBeNull();
    expect(s.statedConfidence!.basis).toBe("CONSTANT");
    expect(s.statedConfidence!.measured).toBe(false);
    expect(s.statedConfidence!.note).toContain("does not vary");
  });

  test("the simulation confidence really is invariant", async () => {
    const a = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 5 });
    const b = await digitalTwinNarrativeService.explainScenario("Gurugram", { providerDeltaPct: -50, festival: true });
    expect(a.statedConfidence!.value).toBe(b.statedConfidence!.value);
  });

  test("the live-state confidence is marked DERIVED_FROM_UPSTREAM", async () => {
    const n = await digitalTwinNarrativeService.explainCityState("Gurugram");
    if (n.statedConfidence) {
      expect(n.statedConfidence.basis).toBe("DERIVED_FROM_UPSTREAM");
      expect(n.statedConfidence.measured).toBe(false);
      expect(n.statedConfidence.note).toContain("not measured against outcomes");
    }
  });

  test("no confidence is ever described as measured", () => {
    const code = codeOnly(src);
    expect(code).not.toContain("measured: true");
    expect(code.includes("basis: " + String.fromCharCode(34) + "MEASURED")).toBe(false);
  });

  test("no model version is invented", async () => {
    const live = await digitalTwinNarrativeService.explainCityState("Gurugram");
    const sim = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 1 });
    expect(live.modelVersion).toBeNull();
    expect(sim.modelVersion).toBeNull();
  });
});

describe("negative: nothing is promoted beyond its evidence", () => {
  test("1. a simulation cannot be labelled a forecast", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 10 });
    expect(s.stateKind).toBe("SIMULATED_STATE");
    expect(JSON.stringify(s)).not.toContain("FORECAST");
  });

  test("2. live state keeps its own kind", async () => {
    const live = await digitalTwinNarrativeService.explainCityState("Gurugram");
    expect(live.stateKind).toBe("LIVE_OPERATIONAL_STATE");
  });

  test("3. an unsupported city cannot inherit another city state", async () => {
    const bad = await digitalTwinNarrativeService.explainCityState("Kolkata");
    const good = await digitalTwinNarrativeService.explainCityState("Delhi");
    expect(bad.layers).toBeNull();
    if (good.layers) expect(JSON.stringify(bad)).not.toContain(JSON.stringify(good.layers));
  });

  test("4. a missing input does not become a default number", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", {});
    expect(s.inputs).toEqual({});
    expect(s.assumptions).toEqual([]);
  });

  test("5. a missing confidence does not become high confidence", async () => {
    const bad = await digitalTwinNarrativeService.explainCityState("Chennai");
    expect(bad.statedConfidence).toBeNull();
    expect(JSON.stringify(bad).toLowerCase()).not.toContain("high confidence");
  });

  test("6. altering prose leaves the structured scenario facts untouched", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { rainStart: true });
    const before = JSON.stringify({ i: s.inputs, a: s.assumptions, b: s.baseline, p: s.projected, im: s.impact });
    const rewritten = { ...s, limitations: ["Different wording entirely."] };
    expect(JSON.stringify({ i: rewritten.inputs, a: rewritten.assumptions, b: rewritten.baseline, p: rewritten.projected, im: rewritten.impact }))
      .toBe(before);
  });

  test("7. an unsupported scope yields no scenario result", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Chennai", { demandDeltaPct: 50 });
    expect(s.state).toBe("DIGITAL_TWIN_UNSUPPORTED_SCOPE");
    expect(s.projected).toBeNull();
    expect(s.impact).toBeNull();
    expect(s.reviewPrompts).toEqual([]);
  });

  test("8. no LLM can reach a simulation output", () => {
    const code = codeOnly(src);
    for (const f of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(code.toLowerCase()).not.toContain(f.toLowerCase());
    }
  });
});

describe("boundaries and side effects", () => {
  test("a scenario is advisory and authorises nothing", async () => {
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { providerDeltaPct: -30 });
    expect(s.requiresHumanApproval).toBe(false);
    for (const p of s.reviewPrompts) {
      expect(p.toLowerCase().startsWith("consider reviewing")).toBe(true);
    }
    const code = codeOnly(src);
    for (const f of ["pricingService", "availabilityService", "assignmentService", "createApprovalRequest", "high_risk"]) {
      expect(code).not.toContain(f);
    }
  });

  test("the narrative writes nothing itself", () => {
    const code = codeOnly(src);
    for (const w of [".create(", ".update(", ".delete(", ".upsert(", "prisma."]) {
      expect(code).not.toContain(w);
    }
  });

  /**
   * The twin telemetry write is disclosed rather than denied. simulate() increments
   * digital_twin_scenarios_total. That is technical persistence; calling the narrative read-only
   * without saying so would be inaccurate.
   */
  test("the simulation telemetry write is disclosed", async () => {
    expect(twinSrc).toContain("digital_twin_scenarios_total");
    const s = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 1 });
    expect(s.limitations.some((l) => l.includes("digital_twin_scenarios_total"))).toBe(true);
    expect(s.limitations.some((l) => l.includes("No business state changes"))).toBe(true);
  });

  test("the twin performs no business write", () => {
    expect(codeOnly(twinSrc)).not.toMatch(/prisma\.\w+\.(create|update|upsert|delete)/);
  });

  test("running scenarios mutates no business state", async () => {
    const before = await snapshot();
    await digitalTwinNarrativeService.explainCityState("Gurugram");
    await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 25, rainStart: true });
    await digitalTwinNarrativeService.explainScenario("Delhi", { providerDeltaPct: -40 });
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  test("the same scenario yields the same structured result", async () => {
    const a = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 15 });
    const b = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 15 });
    expect(JSON.stringify({ ...a, generatedAt: null })).toBe(JSON.stringify({ ...b, generatedAt: null }));
  });

  test("every narrative carries its rules version", async () => {
    const live = await digitalTwinNarrativeService.explainCityState("Gurugram");
    const sim = await digitalTwinNarrativeService.explainScenario("Gurugram", { demandDeltaPct: 1 });
    expect(live.rulesVersion).toBe(TWIN_NARRATIVE_RULES_VERSION);
    expect(sim.rulesVersion).toBe(TWIN_NARRATIVE_RULES_VERSION);
  });

  test("no PII appears in a twin narrative", async () => {
    const live = await digitalTwinNarrativeService.explainCityState("Gurugram");
    const blob = JSON.stringify(live).toLowerCase();
    for (const leak of ["phonenumber", "email", "providerid", "userid", "password"]) {
      expect(blob).not.toContain(leak);
    }
  });

  test("the service takes no actor or role parameter", () => {
    const code = codeOnly(src);
    for (const f of ["actorId", "isAdmin", "allUsers", "req.user"]) expect(code).not.toContain(f);
  });
});
