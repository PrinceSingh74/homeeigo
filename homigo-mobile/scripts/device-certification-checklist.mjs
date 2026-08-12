#!/usr/bin/env node
/**
 * Phase 6: Device certification checklist — all entries BLOCKED until physical device proof.
 */
const DEVICES = [
  { id: "android-10", platform: "Android 10", oem: "generic", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "android-11", platform: "Android 11", oem: "generic", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "android-12", platform: "Android 12", oem: "generic", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "android-13", platform: "Android 13", oem: "generic", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "android-14", platform: "Android 14", oem: "generic", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "android-15", platform: "Android 15", oem: "generic", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "samsung", platform: "Android", oem: "Samsung", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "pixel", platform: "Android", oem: "Google Pixel", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "oneplus", platform: "Android", oem: "OnePlus", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "iphone", platform: "iOS", oem: "iPhone", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "tablet-ipad", platform: "iOS", oem: "iPad", status: "BLOCKED", reason: "No physical device runtime proof" },
  { id: "tablet-android", platform: "Android", oem: "Tablet", status: "BLOCKED", reason: "No physical device runtime proof" },
];

const CHECKS_PER_DEVICE = [
  "cold_start_interactive_under_3s",
  "telemetry_queue_replay",
  "offline_mutation_replay",
  "websocket_reconnect",
  "sentry_crash_delivery",
  "push_notification_delivery",
  "maps_tracking_render",
];

const checklist = {
  generatedAt: new Date().toISOString(),
  overallStatus: "BLOCKED",
  note: "All devices BLOCKED until physical hardware completes runtime certification",
  devices: DEVICES.map((d) => ({
    ...d,
    checks: Object.fromEntries(CHECKS_PER_DEVICE.map((c) => [c, { status: "BLOCKED", evidence: null }])),
  })),
};

const blocked = checklist.devices.every((d) => d.status === "BLOCKED");
console.log(JSON.stringify(checklist, null, 2));
console.error(`\n[device-certification] ${blocked ? "ALL BLOCKED" : "PARTIAL"} — ${checklist.devices.length} devices, 0 proven`);
process.exit(blocked ? 2 : 1);
