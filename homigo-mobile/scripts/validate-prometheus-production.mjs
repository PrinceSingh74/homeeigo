#!/usr/bin/env node
/**
 * Phase 2: Prometheus + Alertmanager production validation via Docker promtool/amtool.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..", "apps", "backend");
const MONITORING = join(BACKEND, "monitoring");
const RULES = join(MONITORING, "rules", "homigo-alerts.yml");
const AM_SRC = join(MONITORING, "alertmanager.yml");
const TMP = join(HERE, "..", ".validation-tmp");

const PROM_IMAGE = "prom/prometheus:v2.54.1";
const AM_IMAGE = "prom/alertmanager:v0.27.0";

function dockerAvailable() {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}

function promtool(args) {
  const mount = process.platform === "win32" ? MONITORING.replace(/\\/g, "/") : MONITORING;
  return execSync(
    `docker run --rm --entrypoint promtool -v "${mount}:/etc/prometheus" ${PROM_IMAGE} ${args}`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

function amtool(args, configPath) {
  const dir = process.platform === "win32" ? dirname(configPath).replace(/\\/g, "/") : dirname(configPath);
  const file = "alertmanager-resolved.yml";
  return execSync(
    `docker run --rm --entrypoint amtool -v "${dir}:/etc/am" ${AM_IMAGE} check-config /etc/am/${file}`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[validate:prometheus] ${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
}

async function main() {
  if (!dockerAvailable()) {
    record("docker_available", false, "Docker not running — cannot run promtool/amtool");
    process.exit(1);
  }
  record("docker_available", true, "Docker OK");

  try {
    const out = promtool("check rules /etc/prometheus/rules/homigo-alerts.yml");
    record("promtool_check_rules", true, out.trim().split("\n").pop() ?? "rules valid");
  } catch (e) {
    record("promtool_check_rules", false, String(e.stderr ?? e.stdout ?? e.message).slice(0, 300));
  }

  mkdirSync(TMP, { recursive: true });
  const amResolved = join(TMP, "alertmanager-resolved.yml");
  const amContent = readFileSync(AM_SRC, "utf8").replace(/\$\{[^}]+\}/g, (match) => {
    if (match.includes("SLACK")) return "https://hooks.slack.com/services/T000/B000/XXXX";
    if (match.includes("SMTP_SMARTHOST")) return "localhost:587";
    if (match.includes("SMTP_USERNAME")) return "alerts";
    if (match.includes("SMTP_PASSWORD")) return "password";
    return "placeholder";
  });
  writeFileSync(amResolved, amContent);

  try {
    const out = amtool("", amResolved);
    record("amtool_check_config", true, out.trim().split("\n").pop() ?? "config valid");
  } catch (e) {
    record("amtool_check_config", false, String(e.stderr ?? e.stdout ?? e.message).slice(0, 300));
  }

  // Rule loading test — promtool unit test for mobile startup alert firing
  const testRules = join(TMP, "mobile-startup-test.yml");
  writeFileSync(
    testRules,
    `rule_files:
  - /etc/prometheus/rules/homigo-alerts.yml

evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'homigo_mobile_startup_failure_total{platform="ios"}'
        values: '0+2x30'
      - series: 'homigo_mobile_startup_observed_total{phase="startup_duration",platform="ios"}'
        values: '0+100x30'
    alert_rule_test:
      - eval_time: 30m
        alertname: MobileStartupFailureRateHigh
        exp_alerts:
          - exp_labels:
              severity: critical
            exp_annotations:
              summary: "Mobile startup failure rate exceeds 1%"
`,
  );

  try {
    const mount = process.platform === "win32" ? TMP.replace(/\\/g, "/") : TMP;
    const rulesMount = process.platform === "win32" ? join(MONITORING, "rules").replace(/\\/g, "/") : join(MONITORING, "rules");
    const out = execSync(
      `docker run --rm --entrypoint promtool -v "${mount}:/tests" -v "${rulesMount}:/etc/prometheus/rules" ${PROM_IMAGE} test rules /tests/mobile-startup-test.yml`,
      { encoding: "utf8" },
    );
    record("promtool_test_rules_firing", true, out.trim().split("\n").pop() ?? "alert fires under synthetic load");
  } catch (e) {
    record(
      "promtool_test_rules_firing",
      false,
      String(e.stderr ?? e.stdout ?? e.message).slice(0, 400),
    );
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n[validate:prometheus] ${failed.length}/${results.length} checks failed`);
    process.exit(1);
  }
  console.log(`\n[validate:prometheus] ${results.length}/${results.length} checks passed`);
}

main();
