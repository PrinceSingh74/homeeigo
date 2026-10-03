/**
 * Pins the customer-facing compliance surface.
 *
 * Under DPDP/GDPR a data subject must be able to withdraw consent and follow a request through to
 * its result. Both capabilities existed in the backend with **no customer consumer**:
 *
 *   - `POST /api/compliance/consent/withdraw` had no client method at all.
 *   - `GET  /api/compliance/request/:id` had no client method at all.
 *   - `myRequests` and `exportDownload` were defined in the API client and **never called**, so a
 *     customer could submit a ZIP export, receive a toast with a truncated reference, and then have
 *     no way to see its status or download the result.
 *
 * These are structural assertions over source, so they need no database and cannot skip silently.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const backend = (...p: string[]) => readFileSync(join(import.meta.dir, "..", ...p), "utf8");
const web = (...p: string[]) => readFileSync(join(import.meta.dir, "..", "..", "..", "web", "src", ...p), "utf8");

const ROUTES = backend("routes", "compliance.ts");
const SERVICE = backend("services", "compliance.service.ts");
const CLIENT = web("services", "core", "api.ts");
const PANEL = web("components", "profile", "DataRequests.tsx");
const SETTINGS = web("app", "(with-bottom-nav)", "(aurora-nav)", "settings", "page.tsx");

describe("compliance — customer wiring", () => {
  it("exposes a client method for every customer compliance endpoint", () => {
    for (const path of [
      "/api/compliance/consent/withdraw",
      "/api/compliance/request/",
      "/api/compliance/requests",
      "/api/compliance/export",
      "/api/compliance/delete",
    ]) {
      expect(CLIENT).toContain(path);
    }
  });

  it("consumes request status and consent withdrawal from the UI, not just the client", () => {
    // A method defined and never called is what produced this defect in the first place.
    expect(PANEL).toContain("coreApi.compliance.getRequest");
    expect(PANEL).toContain("coreApi.compliance.withdrawConsent");
    expect(PANEL).toContain("coreApi.compliance.myRequests");
    expect(SETTINGS).toContain("<DataRequests />");
  });

  /**
   * The backend rejects any policy outside its allow-list with 400 INVALID_INPUT. If the client
   * union drifts, the customer gets a rejected request and no way to withdraw that consent.
   */
  it("keeps the client policy union identical to the backend allow-list", () => {
    const backendList = ROUTES.match(/const policyTypes = \[([^\]]*)\]/);
    expect(backendList).not.toBeNull();
    const backendTypes = [...backendList![1]!.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]!).sort();

    const clientUnion = CLIENT.match(/export type ConsentPolicyType =([^;]*);/);
    expect(clientUnion).not.toBeNull();
    const clientTypes = [...clientUnion![1]!.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]!).sort();

    expect(clientTypes).toEqual(backendTypes);
    expect(backendTypes.length).toBeGreaterThan(0);
  });

  it("offers exactly those policies in the UI", () => {
    const backendTypes = [...ROUTES.match(/const policyTypes = \[([^\]]*)\]/)![1]!.matchAll(/"([A-Z]+)"/g)]
      .map((m) => m[1]!)
      .sort();
    const uiTypes = [...PANEL.matchAll(/value:\s*"([A-Z]+)"/g)].map((m) => m[1]!).sort();
    expect(uiTypes).toEqual(backendTypes);
  });

  it("scopes every customer read by the owning user, so one customer cannot read another's request", () => {
    // `findFirst({ where: { id, userId } })` returns null for a foreign id, which the route turns
    // into 404 — ownership is enforced in the query, not by filtering after the fact.
    expect(SERVICE).toMatch(/getRequestForUser[\s\S]{0,200}where:\s*\{\s*id:\s*requestId,\s*userId\s*\}/);
    expect(SERVICE).toMatch(/getExportForUser[\s\S]{0,200}where:\s*\{\s*id:\s*exportId,\s*userId\s*\}/);
    expect(SERVICE).toMatch(/listUserRequests[\s\S]{0,200}where:\s*\{\s*userId\s*\}/);
  });

  it("requires authentication on every customer compliance route", () => {
    expect(ROUTES).toMatch(/complianceRoutes = new Elysia\(\{ prefix: "\/api\/compliance" \}\)\s*\.use\(authPlugin\)/);
    for (const handler of ["/consent/withdraw", "/request/:id", "/requests", "/export", "/delete"]) {
      const i = ROUTES.indexOf(`"${handler}"`);
      expect(i).toBeGreaterThan(-1);
      expect(ROUTES.slice(i, i + 400)).toContain("requireAuth");
    }
  });

  it("never marks a request complete on the client", () => {
    // Status is rendered from the response. An optimistic "completed" would tell a data subject
    // their erasure had happened when it had not.
    expect(PANEL).not.toMatch(/status\s*=\s*["']COMPLETED["']/);
    expect(PANEL).toContain("detail.status");
  });

  it("uses the server-provided download url rather than constructing one", () => {
    // A locally-built URL produces a download button that looks ready before the export exists.
    expect(PANEL).toContain("detail.export?.fileUrl");
  });
});
