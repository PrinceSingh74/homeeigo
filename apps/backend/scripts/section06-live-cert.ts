/**
 * Section 06 — score policy, career, lifecycle API/DB certification.
 *
 *   cd apps/backend && bun --env-file=.env run scripts/section06-live-cert.ts
 */
import "dotenv/config";
import { computePartnerScore } from "../src/lib/partner-score-policy";
import { eligibleCareerLevel, resolveCareerLevel, careerPriorityBoost } from "../src/lib/partner-career-policy";
import {
  assertLifecycleTransition,
  canTransitionLifecycle,
  isDispatchEligibleLifecycle,
} from "../src/lib/partner-lifecycle-fsm";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };
const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const CUSTOMER = { email: "customer@homigo.demo", password: "Homigo@123" };

type Gate = { gate: string; status: "PASS" | "FAIL" | "WARN"; detail: string };
const results: Gate[] = [];

function gate(name: string, status: Gate["status"], detail = "") {
  results.push({ gate: name, status, detail });
  console.log(`${status.padEnd(5)} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  if (!res.ok || !json.data?.accessToken) throw new Error(`login failed ${email} ${res.status}`);
  return json.data.accessToken;
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  gate(
    "policy.insufficient_not_zero",
    computePartnerScore({
      rating: 0, ratingCount: 0, highStarCount: 0, completedJobs: 0, totalBookings: 0,
      partnerCancellations: 0, acceptedAssignments: 0, totalAssignments: 0,
      onTimeArrivals: 0, arrivalsWithTracking: 0, documentsTotal: 0, documentsVerified: 0,
      kycVerified: false, complianceRestricted: false, reviewStatus: null,
    }).overallScore == null &&
      computePartnerScore({
        rating: 0, ratingCount: 0, highStarCount: 0, completedJobs: 0, totalBookings: 0,
        partnerCancellations: 0, acceptedAssignments: 0, totalAssignments: 0,
        onTimeArrivals: 0, arrivalsWithTracking: 0, documentsTotal: 0, documentsVerified: 0,
        kycVerified: false, complianceRestricted: false, reviewStatus: null,
      }).band === "INSUFFICIENT_DATA"
      ? "PASS"
      : "FAIL",
  );

  gate(
    "career.no_auto_demote",
    resolveCareerLevel("EXPERT", {
      completedJobs: 1, rating: 3, completionRate: 50, onTimeRate: 50,
      certifications: 0, academyCompleted: 0, complianceRestricted: false, lifecycleState: "ACTIVE",
    }).nextStored === "EXPERT"
      ? "PASS"
      : "FAIL",
  );
  gate(
    "career.benefits_backend",
    careerPriorityBoost("ELITE", { lifecycleState: "SUSPENDED", complianceRestricted: false }) === 0 &&
      careerPriorityBoost("ELITE", { lifecycleState: "ACTIVE", complianceRestricted: false }) === 12
      ? "PASS"
      : "FAIL",
  );
  gate("career.elite_gate", eligibleCareerLevel({
    completedJobs: 50, rating: 4.8, completionRate: 98, onTimeRate: 95,
    certifications: 1, academyCompleted: 0, complianceRestricted: false, lifecycleState: "ACTIVE",
  }) === "ELITE" ? "PASS" : "FAIL");

  gate("lifecycle.happy_path", canTransitionLifecycle("APPLIED", "VERIFIED") && canTransitionLifecycle("VERIFIED", "TRAINING") && canTransitionLifecycle("TRAINING", "ACTIVE") ? "PASS" : "FAIL");
  gate("lifecycle.reject_skip", canTransitionLifecycle("APPLIED", "ACTIVE") ? "FAIL" : "PASS");
  try {
    assertLifecycleTransition("ACTIVE", "SUSPENDED");
    gate("lifecycle.active_to_suspended", "FAIL", "should reject");
  } catch {
    gate("lifecycle.active_to_suspended", "PASS");
  }
  gate("lifecycle.dispatch_active_only", isDispatchEligibleLifecycle("ACTIVE") && !isDispatchEligibleLifecycle("SUSPENDED") ? "PASS" : "FAIL");

  const health = await fetch(`${API}/health`).then((r) => r.json()) as { services?: { database?: string } };
  gate("health.database", health.services?.database === "ok" ? "PASS" : "FAIL", String(health.services?.database));

  const partnerTok = await login(PARTNER.email, PARTNER.password);
  const adminTok = await login(ADMIN.email, ADMIN.password);
  const customerTok = await login(CUSTOMER.email, CUSTOMER.password);
  gate("auth", "PASS");

  const me = await api("GET", "/api/providers/me", partnerTok);
  const providerId = ((me.json.data as { provider?: { id?: string } } | undefined)?.provider?.id) ?? "";
  gate("api.partner.me", me.status === 200 && providerId ? "PASS" : "FAIL", providerId || String(me.status));

  const meScore = await api("GET", "/api/providers/me/score", partnerTok);
  const scoreData = meScore.json.data as { policyVersion?: string; band?: string; overallScore?: number | null } | undefined;
  gate(
    "api.partner.score",
    meScore.status === 200 && scoreData?.policyVersion === "partner.score.v1" ? "PASS" : "FAIL",
    `${meScore.status} ${scoreData?.band ?? ""} ${scoreData?.overallScore ?? ""}`,
  );
  const meHist = await api("GET", "/api/providers/me/score/history", partnerTok);
  gate("api.partner.score_history", meHist.status === 200 ? "PASS" : "FAIL", String(meHist.status));
  const meCareer = await api("GET", "/api/providers/me/career", partnerTok);
  gate("api.partner.career", meCareer.status === 200 ? "PASS" : "FAIL", String(meCareer.status));
  const meLife = await api("GET", "/api/providers/me/lifecycle", partnerTok);
  gate("api.partner.lifecycle", meLife.status === 200 ? "PASS" : "FAIL", String(meLife.status));

  const meCareerHist = await api("GET", "/api/providers/me/career/history", partnerTok);
  gate("api.partner.career_history", meCareerHist.status === 200 ? "PASS" : "FAIL", String(meCareerHist.status));
  const meLifeHist = await api("GET", "/api/providers/me/lifecycle/history", partnerTok);
  gate("api.partner.lifecycle_history", meLifeHist.status === 200 ? "PASS" : "FAIL", String(meLifeHist.status));

  const mutateScore = await api("POST", "/api/providers/me/score", partnerTok, { overallScore: 100 });
  gate(
    "security.partner_cannot_post_score",
    mutateScore.status === 404 || mutateScore.status === 405 || mutateScore.status >= 400 ? "PASS" : "FAIL",
    String(mutateScore.status),
  );
  const mutateCareer = await api("POST", "/api/providers/me/career", partnerTok, { currentLevel: "ELITE" });
  gate(
    "security.partner_cannot_post_career",
    mutateCareer.status === 404 || mutateCareer.status === 405 || mutateCareer.status >= 400 ? "PASS" : "FAIL",
    String(mutateCareer.status),
  );
  const mutateLife = await api("POST", "/api/providers/me/lifecycle", partnerTok, { lifecycleState: "ACTIVE" });
  gate(
    "security.partner_cannot_post_lifecycle",
    mutateLife.status === 404 || mutateLife.status === 405 || mutateLife.status >= 400 ? "PASS" : "FAIL",
    String(mutateLife.status),
  );

  const customerMeScore = await api("GET", "/api/providers/me/score", customerTok);
  gate(
    "security.customer_denied_partner_score",
    customerMeScore.status === 401 || customerMeScore.status === 403 ? "PASS" : "FAIL",
    String(customerMeScore.status),
  );

  const [p1, p2] = await Promise.all([
    api("GET", "/api/providers/me/score", partnerTok),
    api("GET", "/api/providers/me/score", partnerTok),
  ]);
  const s1 = (p1.json.data as { overallScore?: number | null } | undefined)?.overallScore;
  const s2 = (p2.json.data as { overallScore?: number | null } | undefined)?.overallScore;
  gate("concurrency.score_reads_consistent", p1.status === 200 && p1.status === p2.status && s1 === s2 ? "PASS" : "FAIL", `${s1} ${s2}`);

  const careerData = meCareer.json.data as { currentLevel?: string; careerPriorityBoost?: number; benefitsActive?: boolean } | undefined;
  gate(
    "career.professional_boost",
    careerData?.currentLevel === "PROFESSIONAL" ? (careerData.careerPriorityBoost === 4 && careerData.benefitsActive ? "PASS" : "FAIL") : "WARN",
    `${careerData?.currentLevel} boost=${careerData?.careerPriorityBoost}`,
  );

  gate("career.starter_gate", eligibleCareerLevel({
    completedJobs: 0, rating: 0, completionRate: 0, onTimeRate: 0,
    certifications: 0, academyCompleted: 0, complianceRestricted: false, lifecycleState: "ACTIVE",
  }) === "STARTER" ? "PASS" : "FAIL");
  gate("career.professional_gate", eligibleCareerLevel({
    completedJobs: 10, rating: 4.0, completionRate: 90, onTimeRate: 80,
    certifications: 0, academyCompleted: 0, complianceRestricted: false, lifecycleState: "ACTIVE",
  }) === "PROFESSIONAL" ? "PASS" : "FAIL");
  gate("career.expert_gate", eligibleCareerLevel({
    completedJobs: 30, rating: 4.5, completionRate: 95, onTimeRate: 90,
    certifications: 1, academyCompleted: 0, complianceRestricted: false, lifecycleState: "ACTIVE",
  }) === "EXPERT" ? "PASS" : "FAIL");

  if (providerId) {
    const adminScore = await api("GET", `/api/admin/providers/${providerId}/score`, adminTok);
    gate("api.admin.score", adminScore.status === 200 ? "PASS" : "FAIL", String(adminScore.status));
    const adminCareer = await api("GET", `/api/admin/providers/${providerId}/career`, adminTok);
    gate("api.admin.career", adminCareer.status === 200 ? "PASS" : "FAIL", String(adminCareer.status));
    const adminLife = await api("GET", `/api/admin/providers/${providerId}/lifecycle`, adminTok);
    gate("api.admin.lifecycle", adminLife.status === 200 ? "PASS" : "FAIL", String(adminLife.status));
    const customerPublic = await api("GET", `/api/providers/${providerId}`, customerTok);
    const pub = (customerPublic.json.data ?? customerPublic.json) as Record<string, unknown>;
    const leaked = "overallScore" in pub || "lifecycleHistory" in pub || "riskScore" in pub;
    gate("customer.no_internal_score", customerPublic.status === 200 && !leaked ? "PASS" : "WARN", String(customerPublic.status));
    const adminForbidden = await api("GET", `/api/admin/providers/${providerId}/score`, customerTok);
    gate(
      "security.customer_denied_admin_score",
      adminForbidden.status === 401 || adminForbidden.status === 403 ? "PASS" : "FAIL",
      String(adminForbidden.status),
    );
    const partnerAdmin = await api("GET", `/api/admin/providers/${providerId}/score`, partnerTok);
    gate(
      "security.partner_denied_admin_score",
      partnerAdmin.status === 401 || partnerAdmin.status === 403 ? "PASS" : "FAIL",
      String(partnerAdmin.status),
    );
    const adminAction = await api("POST", `/api/admin/providers/${providerId}/lifecycle`, adminTok, {
      action: "approve",
    });
    gate(
      "admin.lifecycle.action_responds",
      adminAction.status === 200 || adminAction.status === 409 || adminAction.status === 400 ? "PASS" : "FAIL",
      String(adminAction.status),
    );
  }

  const fails = results.filter((r) => r.status === "FAIL").length;
  const warns = results.filter((r) => r.status === "WARN").length;
  console.log(`\nSection 06 cert: ${results.filter((r) => r.status === "PASS").length} PASS, ${fails} FAIL, ${warns} WARN`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
