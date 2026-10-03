import { NextRequest, NextResponse } from "next/server";

/**
 * Timeout-bounded API proxy. The next.config rewrite to :3000 does not fail fast:
 * when the backend is restarting, Next holds the browser request for minutes and
 * then returns a generic 500 (ECONNRESET). Login OTP verify dies on that path.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = (process.env.BACKEND_ORIGIN || "http://127.0.0.1:3000").replace(/\/+$/, "");
const PROXY_MS = 15_000;
const HOP = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `${BACKEND}/api/${path.join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(PROXY_MS),
    });
    const out = new Headers();
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie" || HOP.has(key.toLowerCase())) return;
      out.append(key, value);
    });
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    for (const cookie of cookies) out.append("set-cookie", cookie);
    return new NextResponse(upstream.body, { status: upstream.status, headers: out });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return NextResponse.json(
      {
        success: false,
        error: timedOut
          ? "The API timed out. Please try again."
          : "Could not reach the API. Make sure the backend is running.",
        code: timedOut ? "REQUEST_TIMEOUT" : "SERVICE_UNAVAILABLE",
      },
      { status: timedOut ? 504 : 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
