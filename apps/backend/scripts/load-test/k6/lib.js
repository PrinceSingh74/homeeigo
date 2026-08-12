// Shared helpers for HOMIGO k6 load tests.
//
// Env:
//   BASE_URL   (default http://localhost:3000)
//   STAGE      100 | 500 | 1000  (peak VUs; default 100)
//   LOGIN_EMAIL / LOGIN_PASSWORD  (optional; enables authed flows)
//   ALLOW_WRITES=1                (optional; enables mutating flows — STAGING ONLY)
//
// SLO thresholds (P2 success criteria):
//   p95 < 500ms, p99 < 1200ms, error rate < 1%.
import http from "k6/http";
import { check } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

export const BASE = __ENV.BASE_URL || "http://localhost:3000";
export const ALLOW_WRITES = __ENV.ALLOW_WRITES === "1";

export const latency = new Trend("homigo_latency_ms", true);
export const errors = new Rate("homigo_errors");
export const reqs = new Counter("homigo_requests");

const PEAK = Number(__ENV.STAGE || 100);

// Ramp: warm → peak → sustain → drain. Same shape at every scale.
export function stages(peak = PEAK) {
  return [
    { duration: "30s", target: Math.ceil(peak * 0.25) },
    { duration: "1m", target: peak },
    { duration: "2m", target: peak },
    { duration: "30s", target: 0 },
  ];
}

export const thresholds = {
  homigo_latency_ms: ["p(95)<500", "p(99)<1200"],
  homigo_errors: ["rate<0.01"],
  http_req_failed: ["rate<0.05"],
};

export function baseOptions(peak) {
  return { stages: stages(peak), thresholds, summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"] };
}

// Authenticated token (best-effort; flows degrade to anonymous if login disabled).
export function login() {
  const email = __ENV.LOGIN_EMAIL;
  const password = __ENV.LOGIN_PASSWORD;
  if (!email || !password) return null;
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password, setAuthCookies: false }), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "login" },
  });
  try {
    return res.json("data.accessToken") || null;
  } catch (_) {
    return null;
  }
}

export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

// Instrumented GET/POST that feed the shared metrics + SLO checks.
export function get(path, params = {}) {
  const res = http.get(`${BASE}${path}`, params);
  record(res, params.tags ? params.tags.name : path);
  return res;
}

export function post(path, body, params = {}) {
  const res = http.post(`${BASE}${path}`, typeof body === "string" ? body : JSON.stringify(body), params);
  record(res, params.tags ? params.tags.name : path);
  return res;
}

function record(res, name) {
  latency.add(res.timings.duration);
  reqs.add(1);
  // 4xx for unauth/validation in read-only mode is expected; only 5xx + transport = error.
  const failed = res.status === 0 || res.status >= 500;
  errors.add(failed);
  check(res, { [`${name}: no server error`]: (r) => r.status < 500 });
}

// handleSummary writer — drops JSON evidence into docs/p2/evidence/.
export function writeSummary(scenario, data) {
  const out = {};
  out[`../../../../../docs/p2/evidence/k6-${scenario}-${__ENV.STAGE || "100"}.json`] = JSON.stringify(data, null, 2);
  out["stdout"] = textSummary(data);
  return out;
}

function textSummary(data) {
  const m = data.metrics || {};
  const p = (k, s) => (m[k] && m[k].values && m[k].values[s] !== undefined ? m[k].values[s].toFixed(2) : "n/a");
  return [
    "",
    `peak VUs: ${__ENV.STAGE || 100}`,
    `requests: ${p("homigo_requests", "count")}`,
    `latency p95: ${p("homigo_latency_ms", "p(95)")}ms  p99: ${p("homigo_latency_ms", "p(99)")}ms`,
    `error rate: ${p("homigo_errors", "rate")}`,
    `http_req_failed: ${p("http_req_failed", "rate")}`,
    "",
  ].join("\n");
}
