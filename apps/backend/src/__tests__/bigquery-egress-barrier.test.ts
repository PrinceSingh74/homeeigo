/**
 * Release certification Ph14 finding: a NODE_ENV=test runtime against the isolated homigo_test DB
 * (load harness on :3100) started the ETL scheduler and reached the LIVE BigQuery warehouse,
 * because load-env re-applies .env.test after any harness override of ENABLE_ETL_SCHEDULER.
 *
 * The barrier now lives in the modules themselves: the ETL client, both forecast services and the
 * scheduler refuse in a test runtime without ADC, whatever the env flags say.
 */
import { describe, expect, it, afterEach, afterAll } from "bun:test";
import { getBigQuery } from "../../analytics/etl/bq-client";
import { startEtlScheduler, stopEtlScheduler } from "../../analytics/scheduler/etl-scheduler";
import { BQ_NO_CREDENTIALS_MESSAGE, bigQueryAllowed } from "../lib/bigquery-adc";

const fileEnv = {
  adc: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  req: process.env.HOMIGO_REQUIRE_BIGQUERY,
  etl: process.env.ENABLE_ETL_SCHEDULER,
};
afterAll(() => {
  for (const [k, v] of [
    ["GOOGLE_APPLICATION_CREDENTIALS", fileEnv.adc],
    ["HOMIGO_REQUIRE_BIGQUERY", fileEnv.req],
    ["ENABLE_ETL_SCHEDULER", fileEnv.etl],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("BigQuery egress barrier (test runtime, no ADC)", () => {
  const saved = { etl: process.env.ENABLE_ETL_SCHEDULER, adc: process.env.GOOGLE_APPLICATION_CREDENTIALS, req: process.env.HOMIGO_REQUIRE_BIGQUERY };

  afterEach(() => {
    stopEtlScheduler();
    process.env.ENABLE_ETL_SCHEDULER = saved.etl;
    if (saved.adc === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = saved.adc;
    if (saved.req === undefined) delete process.env.HOMIGO_REQUIRE_BIGQUERY;
    else process.env.HOMIGO_REQUIRE_BIGQUERY = saved.req;
  });

  it("a shell GOOGLE_APPLICATION_CREDENTIALS does NOT open the barrier in a test runtime", () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "C:/nonexistent/adc.json";
    delete process.env.HOMIGO_REQUIRE_BIGQUERY;
    expect(bigQueryAllowed()).toBe(false);
    process.env.HOMIGO_REQUIRE_BIGQUERY = "1";
    expect(bigQueryAllowed()).toBe(true); // the explicit opt-in is the only way through
  });

  it("the ETL client refuses before constructing a warehouse client", () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.HOMIGO_REQUIRE_BIGQUERY;
    expect(bigQueryAllowed()).toBe(false);
    expect(() => getBigQuery()).toThrow(BQ_NO_CREDENTIALS_MESSAGE);
  });

  it("the scheduler does not start even when ENABLE_ETL_SCHEDULER is not 'false'", async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.HOMIGO_REQUIRE_BIGQUERY;
    process.env.ENABLE_ETL_SCHEDULER = "true";
    const { logger } = await import("../lib/logger");
    const events: string[] = [];
    const orig = logger.info.bind(logger);
    (logger as { info: typeof logger.info }).info = ((msg: string, ...rest: unknown[]) => {
      events.push(msg);
      return (orig as (...a: unknown[]) => unknown)(msg, ...rest);
    }) as typeof logger.info;
    try {
      startEtlScheduler();
    } finally {
      (logger as { info: typeof logger.info }).info = orig;
    }
    expect(events).toContain("etl_scheduler_skipped");
    expect(events).not.toContain("etl_scheduler_started");
  });
});

describe("event-triggered ETL in a test runtime", () => {
  it("returns without running any job (no refused-then-retried BigQuery attempts)", async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.HOMIGO_REQUIRE_BIGQUERY;
    const { triggerEventEtl } = await import("../../analytics/scheduler/etl-scheduler");
    const { logger } = await import("../lib/logger");
    const events: string[] = [];
    const wrap = (level: "info" | "warn" | "error") => {
      const orig = logger[level].bind(logger);
      (logger as Record<string, unknown>)[level] = (msg: string, ...rest: unknown[]) => {
        events.push(msg);
        return (orig as (...a: unknown[]) => unknown)(msg, ...rest);
      };
      return () => ((logger as Record<string, unknown>)[level] = orig);
    };
    const restores = [wrap("info"), wrap("warn"), wrap("error")];
    const t0 = Date.now();
    try {
      await triggerEventEtl("homigo.booking.completed", "any");
    } finally {
      restores.forEach((r) => r());
    }
    expect(events.filter((e) => e.startsWith("etl_"))).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("OpenWeather egress barrier (test runtime)", () => {
  it("the weather service is unconfigured and answers null without a network call", async () => {
    const { weatherService } = await import("../services/weather.service");
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls++;
      return realFetch(...args);
    }) as typeof fetch;
    try {
      expect(weatherService.isConfigured).toBe(false);
      expect(await weatherService.getByCoords(28.6, 77.3)).toBeNull();
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("Twilio + Google Maps egress barrier (test runtime) — witnessed live in release certification", () => {
  it("OTP send never reaches Twilio: no client, the dev OTP is returned, no network call", async () => {
    const prisma = (await import("../lib/prisma")).default;
    const { OTPService } = await import("../services/otp.service");
    const svc = new OTPService(prisma);
    expect((svc as unknown as { twilioClient: unknown }).twilioClient).toBeNull();

    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
      calls++;
      return realFetch(...a);
    }) as typeof fetch;
    try {
      const phone = `+9170${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
      const sent = (await svc.sendOTP(phone)) as { success: boolean; devOtp?: string };
      expect(sent.success).toBe(true);
      expect(sent.devOtp).toMatch(/^\d{6}$/);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("the start-PIN service has no Twilio client either", async () => {
    const mod = await import("../services/booking-start-otp.service");
    const svc = (mod as Record<string, unknown>).bookingStartOtpService as { twilioClient: unknown };
    expect(svc.twilioClient).toBeNull();
  });

  it("Google Maps is unconfigured, so no billed call can be made", async () => {
    const { mapsService } = await import("../services/maps.service");
    expect(mapsService.isConfigured).toBe(false);
  });
});
