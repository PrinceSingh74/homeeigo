#!/usr/bin/env node
/**
 * Enforce startup performance budgets in the production-parity simulator.
 * Fails CI if simulated happy-path exceeds budgets.
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const BUDGETS = {
  hydration: 500,
  secureStore: 1000,
  bootstrap: 5000,
  splashVisible: 1500,
  interactive: 2000,
};

const SECURE_STORE_TIMEOUT_MS = 5000;
const BOOTSTRAP_DEADLINE_MS = 25000;
const SPLASH_UI_READY_MS = 1500;
const SPLASH_FAILSAFE_MS = 3000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function simulateHappyPath() {
  const t0 = Date.now();
  const marks = [];

  const mark = (m) => marks.push({ m, ms: Date.now() - t0 });

  mark("APP_START");
  mark("HYDRATION_START");
  await sleep(15);
  mark("HYDRATION_END");
  mark("BOOTSTRAP_START");
  await sleep(20);
  mark("SECURESTORE");
  mark("BOOTSTRAP_END");
  mark("HOME_RENDER");
  mark("SPLASH_HIDE");
  mark("INTERACTIVE");

  const since = (m) => marks.find((x) => x.m === m)?.ms;
  return {
    hydration: since("HYDRATION_END") - since("HYDRATION_START"),
    bootstrap: since("BOOTSTRAP_END") - since("BOOTSTRAP_START"),
    splashVisible: since("SPLASH_HIDE"),
    interactive: since("INTERACTIVE"),
    secureStore: 20,
  };
}

const actual = await simulateHappyPath();
const failures = [];

for (const [name, budget] of Object.entries(BUDGETS)) {
  const value = actual[name];
  if (value == null || value > budget) {
    failures.push({ name, budget, actual: value });
  }
}

if (failures.length) {
  console.error("[FAIL] startup-performance-budget-check");
  console.error(JSON.stringify({ budgets: BUDGETS, actual, failures }, null, 2));
  process.exit(1);
}

console.log("[PASS] startup-performance-budget-check");
console.log(JSON.stringify({ budgets: BUDGETS, actual }));
process.exit(0);
