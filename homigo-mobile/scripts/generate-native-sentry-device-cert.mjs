#!/usr/bin/env node
/** Generate native-sentry-device-certification.md from evidence JSON. */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".certification-evidence");
const EVIDENCE = join(OUT, "native-sentry-device-evidence.json");
const RUN = join(OUT, "native-sentry-device-run.json");
const DOC = join(ROOT, "native-sentry-device-certification.md");

function load(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function checkRow(name, check) {
  const status = check?.ok ? "PASS" : "FAIL";
  return `| ${name} | **${status}** | ${check?.detail ?? "—"} |`;
}

function main() {
  const ev = load(EVIDENCE);
  const run = load(RUN);
  const now = new Date().toISOString().slice(0, 10);
  const verdict = ev?.overallStatus ?? "FAIL";

  const failReasons = [];
  if (!run?.deviceProof?.adbSerial) failReasons.push("No device proof (adb serial missing)");
  if (!ev?.checks?.native_android_event?.ok) failReasons.push("No native Android event in Sentry");
  if (!ev?.checks?.source_maps_attached?.ok) failReasons.push("Source maps absent on release");
  if (ev?.checks?.native_android_event?.detail?.includes("certification")) {
    failReasons.push("Simulated/cert envelope event used");
  }

  const md = `# Native Sentry Device Certification

**Project:** \`homigo-mobile\`  
**Certified at:** ${now}  
**Sentry org:** \`homigo-g4\`  
**Sentry project:** \`${ev?.project ?? "node-fastify"}\`  
**Release:** \`${ev?.releaseVersion ?? ev?.release ?? "homigo-mobile@1.0.0"}\`

**Evidence artifacts:**
- \`.certification-evidence/native-sentry-device-evidence.json\`
- \`.certification-evidence/native-sentry-device-run.json\`

**Commands:**
\`\`\`powershell
cd homigo-mobile
npm run certify:native-sentry-device    # EAS build + APK install + open cert screen
npm run collect:native-sentry-device    # Pull Sentry evidence after device crash
npm run doc:native-sentry-device        # Regenerate this document
\`\`\`

---

## Executive summary

| Verdict | **${verdict}** |
|---------|${verdict === "PASS" ? "-------------|" : "-------------|"}

| Requirement | Status |
|-------------|--------|
| Real EAS build (not Expo Go) | ${run?.steps?.eas_build?.ok ? "**PASS**" : "**FAIL**"} |
| APK installed on physical Android device | ${run?.steps?.apk_install?.ok ? "**PASS**" : "**FAIL**"} |
| Login with real account | ${ev?.checks?.user_context?.ok ? "**PASS**" : "**FAIL**"} |
| Startup flow triggered | ${ev?.checks?.startup_breadcrumbs?.ok ? "**PASS**" : "**FAIL**"} |
| Native crash triggered | ${ev?.checks?.native_android_event?.ok ? "**PASS**" : "**FAIL**"} |

---

## Collected identifiers

| Field | Value |
|-------|-------|
| **Event ID** | \`${ev?.eventId ?? "—"}\` |
| **Issue ID** | \`${ev?.issueId ?? "—"}\` |
| **Device Model** | ${ev?.deviceModel ?? run?.deviceProof?.deviceModel ?? "—"} |
| **Android Version** | ${ev?.androidVersion ?? run?.deviceProof?.androidVersion ?? "—"} |
| **Release Version** | \`${ev?.releaseVersion ?? "homigo-mobile@1.0.0"}\` |

---

## Verification matrix

| Check | Status | Detail |
|-------|--------|--------|
${ev?.checks?.native_android_event ? checkRow("Native Android event visible", ev.checks.native_android_event) : "| Native Android event visible | **FAIL** | No evidence collected |"}
${ev?.checks?.release_attached ? checkRow("Release attached", ev.checks.release_attached) : "| Release attached | **FAIL** | — |"}
${ev?.checks?.source_maps_attached ? checkRow("Source maps attached", ev.checks.source_maps_attached) : "| Source maps attached | **FAIL** | — |"}
${ev?.checks?.user_context ? checkRow("User context attached", ev.checks.user_context) : "| User context attached | **FAIL** | — |"}
${ev?.checks?.startup_breadcrumbs ? checkRow("Startup breadcrumbs attached", ev.checks.startup_breadcrumbs) : "| Startup breadcrumbs attached | **FAIL** | — |"}
${ev?.checks?.stack_symbolicated ? checkRow("Stack symbolicated", ev.checks.stack_symbolicated) : "| Stack symbolicated | **FAIL** | — |"}

---

## Device proof

| Field | Value |
|-------|-------|
| ADB serial | \`${run?.deviceProof?.adbSerial ?? "—"}\` |
| Device model (adb) | ${run?.deviceProof?.deviceModel ?? "—"} |
| Android version (adb) | ${run?.deviceProof?.androidVersion ?? "—"} |
| EAS build ID | \`${run?.steps?.eas_build?.buildId ?? "—"}\` |
| APK install | ${run?.steps?.apk_install?.ok ? "confirmed" : "not confirmed"} |
| Deep link opened | \`${run?.steps?.deep_link?.url ?? CERT_DEEP_LINK}\` |
| Execution environment | EAS preview APK (not Expo Go) |

---

## FAIL criteria audit

| FAIL if | Result |
|---------|--------|
| Expo Go used | ${run?.steps?.eas_build?.ok ? "**PASS** (EAS build)" : "**FAIL**"} |
| Simulated event used | ${ev?.checks?.native_android_event?.ok && !failReasons.includes("Simulated/cert envelope event used") ? "**PASS**" : "**FAIL**"} |
| Source maps absent | ${ev?.checks?.source_maps_attached?.ok ? "**PASS**" : "**FAIL**"} |
| No device proof | ${run?.deviceProof?.adbSerial ? "**PASS**" : "**FAIL**"} |

${failReasons.length ? `\n**Blockers:** ${failReasons.join("; ")}\n` : ""}

---

## Operator playbook (if FAIL)

1. Connect Android device with USB debugging
2. \`npm run certify:native-sentry-device\`
3. Log in with real account on device
4. Cold-start app, navigate to \`homigo://dev/sentry-cert\`
5. Tap **Trigger native crash**
6. \`npm run collect:native-sentry-device\`
7. \`npm run doc:native-sentry-device\`

---

## Certification verdict

| Verdict | Reason |
|---------|--------|
| **${verdict}** | ${
    verdict === "PASS"
      ? "Real EAS APK on physical device; native Android crash in Sentry with release, source maps, user context, startup breadcrumbs, and symbolicated stack."
      : failReasons.length
        ? failReasons.join("; ")
        : "Device-native certification incomplete — see verification matrix."
  } |
`;

  writeFileSync(DOC, md);
  console.log(`Wrote ${DOC}`);
  console.log(`Verdict: ${verdict}`);
}

const CERT_DEEP_LINK = "homigo://dev/sentry-cert";
main();
