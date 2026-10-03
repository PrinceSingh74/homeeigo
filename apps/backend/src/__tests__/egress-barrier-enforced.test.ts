/**
 * The egress barrier must FIRE, not merely exist. Release certification found real SMS and billed
 * Maps calls coming out of the suite, so this file proves, per transport, that a test cannot reach
 * the outside world — and that loopback (Postgres, Redis, the app under test) still works.
 *
 * Every case uses a destination that would be a real connection if the barrier were removed.
 */
import "../load-env";
import { describe, it, expect } from "bun:test";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import prisma from "../lib/prisma";
import { LIVE_PROVIDER_FLAGS, liveProviderAllowed } from "../lib/test-egress";

const EXTERNAL = "api.twilio.com";

describe("no test may reach the outside world", () => {
  it("fetch is blocked", async () => {
    await expect(fetch(`https://${EXTERNAL}/2010-04-01/Accounts`)).rejects.toThrow(/EGRESS_BLOCKED/);
  });

  it("net.connect is blocked", () => {
    expect(() => net.connect(443, EXTERNAL)).toThrow(/EGRESS_BLOCKED/);
    expect(() => net.connect({ host: EXTERNAL, port: 443 })).toThrow(/EGRESS_BLOCKED/);
  });

  it("tls.connect is blocked", () => {
    expect(() => tls.connect({ host: EXTERNAL, port: 443 })).toThrow(/EGRESS_BLOCKED/);
  });

  it("http/https request and get are blocked", () => {
    expect(() => https.request(`https://${EXTERNAL}/x`)).toThrow(/EGRESS_BLOCKED/);
    expect(() => https.get({ hostname: EXTERNAL, path: "/x" })).toThrow(/EGRESS_BLOCKED/);
    expect(() => http.request({ host: EXTERNAL, path: "/x" })).toThrow(/EGRESS_BLOCKED/);
  });

  it("the error names the destination, so the offending call can be found", async () => {
    const err = await fetch(`https://maps.googleapis.com/maps/api/geocode/json`).catch((e: Error) => e);
    expect(String(err)).toContain("maps.googleapis.com");
  });

  it("an unparsable destination fails closed, and IPv6 / trailing-dot forms are handled", () => {
    const net2 = net as unknown as { connect: (...a: unknown[]) => unknown };
    // No host at all on a network call: previously allowed, now refused.
    expect(() => net2.connect({})).toThrow(/EGRESS_BLOCKED/);
    // Trailing dot is the same name.
    expect(() => net.connect({ host: "api.twilio.com.", port: 443 })).toThrow(/EGRESS_BLOCKED/);
    // A ".localhost" suffix on a public domain is not loopback.
    expect(() => net.connect({ host: "evil.com.localhost", port: 80 })).toThrow(/EGRESS_BLOCKED/);
    // …while genuine loopback forms still pass the check.
    for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "::ffff:127.0.0.1"]) {
      const c = net.connect({ host, port: 1 });
      c.on("error", () => undefined); // nothing is listening; only the guard decision matters
      c.destroy();
    }
  });

  it("loopback still works: Postgres answers and a local socket connects", async () => {
    const [{ ok }] = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(ok).toBe(1);
    const port = await new Promise<number>((resolve) => {
      const srv = net.createServer().listen(0, "127.0.0.1", () => resolve((srv.address() as net.AddressInfo).port));
    });
    await new Promise<void>((resolve, reject) => {
      const c = net.connect(port, "127.0.0.1");
      c.once("connect", () => {
        c.destroy();
        resolve();
      });
      c.once("error", reject);
    });
  });
});

describe("per-service barrier (lib/test-egress.ts)", () => {
  it("every provider is closed in a test runtime by default", () => {
    for (const flag of LIVE_PROVIDER_FLAGS) {
      expect(liveProviderAllowed(flag)).toBe(false);
    }
    expect(LIVE_PROVIDER_FLAGS.length).toBeGreaterThanOrEqual(7);
  });

  it("the services that carry real credentials report themselves unconfigured", async () => {
    const { razorpayService } = await import("../services/razorpay.service");
    const { mapsService } = await import("../services/maps.service");
    const { weatherService } = await import("../services/weather.service");
    const { emailService } = await import("../services/email.service");
    expect(razorpayService.isConfigured).toBe(false);
    expect(mapsService.isConfigured).toBe(false);
    expect(weatherService.isConfigured).toBe(false);
    expect(emailService.isConfigured).toBe(false);
  });

  it("Sentry is disabled in a test runtime, so tests cannot alert production", async () => {
    const { observability } = await import("../lib/observability");
    // The module records its own state; a configured DSN would mean test errors reach the real project.
    expect(observability.isEnabled).toBe(false);
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("AI model providers have no keys in a test runtime", async () => {
    const { aiConfig } = await import("../ai/config");
    for (const p of ["anthropic", "gemini", "groq", "openai"] as const) {
      expect((aiConfig as unknown as Record<string, { apiKey?: string }>)[p]?.apiKey).toBeUndefined();
    }
  });
});
