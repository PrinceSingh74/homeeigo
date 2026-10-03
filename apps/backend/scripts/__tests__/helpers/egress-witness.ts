/**
 * Egress WITNESS for child processes a test spawns — the recording half of the barrier.
 *
 * `src/__tests__/helpers/no-external-egress.ts` BLOCKS a non-loopback destination. Blocking alone
 * cannot answer "did the script try?": a refused call and a call never made both leave the network
 * untouched. This preload is loaded AFTER the barrier and wraps the barrier's own hooks, so every
 * attempt is written down first and refused second.
 *
 *   bun --preload <load-env> --preload <no-external-egress> --preload <this file> run <script>
 *
 * One line per attempt is appended to EGRESS_WITNESS_FILE: `<via>\t<host>`. Loopback destinations
 * are recorded too — an empty file would otherwise be indistinguishable from a witness that never
 * loaded, and the test asserts on the file's content, not on its absence.
 */
import { appendFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";

const file = process.env.EGRESS_WITNESS_FILE;

function hostOf(arg: unknown): string {
  if (typeof arg === "string") {
    try {
      return new URL(arg).hostname;
    } catch {
      return arg;
    }
  }
  if (arg instanceof URL) return arg.hostname;
  if (arg && typeof arg === "object") {
    const o = arg as { hostname?: string; host?: string; href?: string; url?: string; path?: string; port?: number };
    if (o.hostname) return o.hostname;
    if (o.host) return String(o.host).split(":")[0];
    if (o.href) return hostOf(o.href);
    if (o.url) return hostOf(o.url);
    if (o.path && !o.port) return `unix:${o.path}`;
  }
  return "<unparsed>";
}

function record(via: string, arg: unknown): void {
  if (!file) return;
  try {
    appendFileSync(file, `${via}\t${hostOf(arg)}\n`);
  } catch {
    // A witness that cannot write must not change what the script does.
  }
}

if (file) {
  appendFileSync(file, "witness\tloaded\n");

  const barredFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    record("fetch", typeof input === "string" || input instanceof URL ? input : (input as Request).url);
    return barredFetch(input, init);
  }) as typeof fetch;

  const wrap = <T extends Record<string, unknown>>(mod: T, name: string, via: string) => {
    const real = mod[name] as (...a: unknown[]) => unknown;
    if (typeof real !== "function") return;
    (mod as Record<string, unknown>)[name] = (...args: unknown[]) => {
      record(via, args[0]);
      return real.apply(mod, args);
    };
  };
  wrap(net as unknown as Record<string, unknown>, "connect", "net.connect");
  wrap(net as unknown as Record<string, unknown>, "createConnection", "net.createConnection");
  wrap(tls as unknown as Record<string, unknown>, "connect", "tls.connect");
  wrap(http as unknown as Record<string, unknown>, "request", "http.request");
  wrap(http as unknown as Record<string, unknown>, "get", "http.get");
  wrap(https as unknown as Record<string, unknown>, "request", "https.request");
  wrap(https as unknown as Record<string, unknown>, "get", "https.get");
}
