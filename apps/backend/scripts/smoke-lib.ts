/** Shared helpers for HOMIGO smoke / lifecycle scripts */

export const DEFAULT_BASE = process.env.API_URL ?? "http://localhost:3000";

export type Json = Record<string, unknown>;

export type SmokeResult = { name: string; pass: boolean; detail: string };

export async function smokeReq(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: Json = {};
  try {
    body = (await res.json()) as Json;
  } catch {
    body = { raw: "<non-json>" };
  }
  return { status: res.status, body };
}

/** Exercise routes on the in-process Elysia app (current codebase, no HTTP server). */
export async function smokeAppReq(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Json }> {
  const { default: app } = await import("../src/index.ts");
  const res = await app.handle(
    new Request(`http://smoke.test${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    }),
  );
  let body: Json = {};
  try {
    body = (await res.json()) as Json;
  } catch {
    body = { raw: "<non-json>" };
  }
  return { status: res.status, body };
}

export async function smokeLogin(
  base: string,
  email: string,
  password: string,
): Promise<{ status: number; token?: string }> {
  const r = await smokeReq(base, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const token = (r.body.data as Json | undefined)?.accessToken as string | undefined;
  return { status: r.status, token };
}

export function printSmokeSummary(results: SmokeResult[], label: string) {
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    console.log(`${icon} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${label}: Passed=${passCount}, Failed=${failCount}\n`);
  return failCount;
}

export async function smokeWsHandshake(
  base: string,
  pathWithQuery: string,
  timeoutMs = 4000,
): Promise<string> {
  const wsUrl = `${base.replace(/^http/i, "ws")}${pathWithQuery}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    const client = new WebSocket(wsUrl);
    client.onopen = () => {
      clearTimeout(timer);
      client.close();
      resolve("open");
    };
    client.onerror = () => {
      clearTimeout(timer);
      resolve("error");
    };
    client.onclose = (event) => {
      if (event.code && event.code !== 1006) {
        clearTimeout(timer);
        resolve(`closed:${event.code}`);
      }
    };
  });
}
