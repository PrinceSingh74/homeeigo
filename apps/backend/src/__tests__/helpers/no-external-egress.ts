/**
 * Second layer of the egress barrier: nothing in a test run may open a socket off this machine.
 *
 * The per-service barrier (lib/test-egress.ts) keeps services on their "unconfigured" path. This one
 * is the seatbelt: it does not care which client library is used. `fetch`, a raw `node:net` socket,
 * `node:http(s)`, `node:tls`, an SDK built on any of them (twilio, @google-cloud/*, @aws-sdk/*,
 * resend, expo-server-sdk) — all of them end up in one of the hooks below, and a non-loopback
 * destination throws `EGRESS_BLOCKED` naming the host, so the offending call is identifiable.
 *
 * Loaded from bunfig `[test].preload`, so it also applies to any `bun test` child process.
 *
 * Escape hatch for a deliberate real-integration test: HOMIGO_ALLOW_EXTERNAL=1.
 *
 * NOT covered, by design: Prisma's native query engine (its own TCP stack, and it only ever talks to
 * the configured test database) and processes this suite spawns with `bun run`/`node` — those are
 * covered by the per-service barrier, which keys off NODE_ENV=test and is inherited.
 */
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]", "::ffff:127.0.0.1", ""]);

function isLocal(host: string | undefined): boolean {
  if (!host) return true; // a unix socket / no host: not an outbound network hop
  // Trailing dot (`example.com.`) and case are both resolvable forms of the same name.
  const h = host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (ALLOWED_HOSTS.has(h)) return true;
  // host.docker.internal resolves to the host machine; the Postgres/Redis containers live there.
  if (h === "host.docker.internal") return true;
  // IPv4-mapped and compressed loopback forms.
  if (/^::ffff:127\./.test(h) || /^127\.\d+\.\d+\.\d+$/.test(h)) return true;
  return false;
}

export class EgressBlockedError extends Error {
  constructor(host: string, via: string) {
    super(`EGRESS_BLOCKED: a test tried to reach "${host}" via ${via}. Set HOMIGO_ALLOW_EXTERNAL=1 only for a deliberate real-integration test.`);
    this.name = "EgressBlockedError";
  }
}

let installed = false;

export function installEgressBarrier(): void {
  if (installed) return;
  installed = true;

  const hostOf = (arg: unknown, fallback?: unknown): string | undefined => {
    if (typeof arg === "string") {
      try {
        return new URL(arg).hostname;
      } catch {
        return arg.split(":")[0];
      }
    }
    if (arg && typeof arg === "object") {
      const o = arg as { host?: string; hostname?: string; href?: string; path?: string };
      if (o.hostname) return o.hostname;
      if (o.host) return o.host.split(":")[0];
      if (o.href) {
        try {
          return new URL(o.href).hostname;
        } catch {
          /* fall through */
        }
      }
    }
    return fallback === undefined ? undefined : hostOf(fallback);
  };

  const guard = (host: string | undefined, via: string) => {
    if (process.env.HOMIGO_ALLOW_EXTERNAL === "1") return;
    if (!isLocal(host)) throw new EgressBlockedError(String(host), via);
  };

  /**
   * A destination we could not parse is NOT assumed safe for network transports — only a genuine
   * unix-socket call (an options object carrying `path` and no host) is. Failing open on an
   * unparsed host is how a barrier quietly stops barring anything.
   */
  const guardStrict = (arg: unknown, host: string | undefined, via: string) => {
    if (process.env.HOMIGO_ALLOW_EXTERNAL === "1") return;
    if (host === undefined) {
      const o = arg as { path?: string; host?: unknown; hostname?: unknown } | undefined;
      const isUnixSocket = typeof o === "object" && o !== null && typeof o.path === "string" && !o.host && !o.hostname;
      if (isUnixSocket) return;
      throw new EgressBlockedError("<unparsed destination>", via);
    }
    guard(host, via);
  };

  // 1. fetch (Bun's native fetch, used by most first-party code)
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    try {
      guard(hostOf(url), "fetch");
    } catch (e) {
      // fetch REJECTS on a transport failure, it does not throw synchronously. Callers (and their
      // try/catch or .catch) must see the barrier exactly as they would see a connection error.
      return Promise.reject(e);
    }
    return realFetch(input, init).then((res) => {
      // A loopback URL that redirects off-machine is still egress; the response URL is the truth.
      try {
        guard(hostOf(res.url), "fetch(redirect)");
      } catch (e) {
        return Promise.reject(e);
      }
      return res;
    });
  }) as typeof fetch;

  // 2. node:net / node:tls — the transport under almost every SDK
  const realNetConnect = net.connect.bind(net);
  const wrapConnect = (real: typeof net.connect, via: string) =>
    ((...args: Parameters<typeof net.connect>) => {
      const [a, b] = args;
      const host = typeof a === "number" ? (typeof b === "string" ? b : "127.0.0.1") : hostOf(a);
      guardStrict(a, host, via);
      return real(...(args as Parameters<typeof net.connect>));
    }) as typeof net.connect;
  net.connect = wrapConnect(realNetConnect, "net.connect");
  net.createConnection = wrapConnect(net.createConnection.bind(net) as typeof net.connect, "net.createConnection") as typeof net.createConnection;

  const realTlsConnect = tls.connect.bind(tls);
  tls.connect = ((...args: unknown[]) => {
    const [a, b] = args;
    const host = typeof a === "number" ? (typeof b === "string" ? b : "127.0.0.1") : hostOf(a);
    guardStrict(a, host, "tls.connect");
    return (realTlsConnect as (...a: unknown[]) => ReturnType<typeof tls.connect>)(...args);
  }) as typeof tls.connect;

  // 3. node:http / node:https request+get (gaxios, teeny-request, aws-sdk, twilio)
  for (const [mod, name] of [
    [http, "http"],
    [https, "https"],
  ] as const) {
    for (const method of ["request", "get"] as const) {
      const real = (mod[method] as (...a: unknown[]) => unknown).bind(mod);
      (mod as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        guardStrict(args[0], hostOf(args[0], args[1]), `${name}.${method}`);
        return real(...args);
      };
    }
  }
  // 4. node:http2 — gRPC clients (@google-cloud/*) reach the network through this, not node:http.
  const realConnect = http2.connect.bind(http2);
  (http2 as unknown as Record<string, unknown>).connect = (...args: unknown[]) => {
    guardStrict(args[0], hostOf(args[0]), "http2.connect");
    return (realConnect as (...a: unknown[]) => unknown)(...args);
  };
}

installEgressBarrier();
