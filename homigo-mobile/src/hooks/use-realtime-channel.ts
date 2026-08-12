import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { reportRecoverySignal } from "@/lib/observability/telemetry";
import { onConnectivityReconnect } from "@/lib/connectivity/connectivity-service";
import { registerWsChannel, unregisterWsChannel } from "@/lib/realtime/ws-registry";

type RealtimeOptions = {
  url: string | null;
  enabled?: boolean;
  onMessage?: (data: string) => void;
  label?: string;
};

export type RealtimeChannel = {
  connected: boolean;
  reconnecting: boolean;
  offline: boolean;
  send: (data: unknown) => boolean;
};

export function useRealtimeChannel({ url, enabled = true, onMessage, label }: RealtimeOptions): RealtimeChannel {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [offline, setOffline] = useState(false);
  const retryRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingRef = useRef(false);
  const generationRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Liveness: mobile sockets frequently go "half-open" on WiFi↔cellular handoff or in
  // tunnels — the OS never fires onclose, so the client believes it is connected while no
  // events arrive (silent event loss). We send keepalive PINGs and run a watchdog that
  // force-closes the socket (→ reconnect) when no inbound frame has arrived in STALE_MS.
  // The backend pings every 30s on every channel, so any healthy socket sees traffic well
  // within the window even when the app itself is idle.
  const lastInboundRef = useRef(Date.now());
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const channelLabel = label ?? (url ? url.split("/ws/")[1]?.split("?")[0] ?? "ws" : "ws-idle");

  useEffect(() => {
    registerWsChannel(channelLabel, { connected, reconnecting, offline });
    return () => unregisterWsChannel(channelLabel);
  }, [channelLabel, connected, offline, reconnecting]);

  useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;

    const STALE_MS = 75_000; // > 2× the backend's 30s server ping
    const PING_EVERY_MS = 25_000;
    const WATCHDOG_EVERY_MS = 10_000;

    const clearLiveTimers = () => {
      if (pingTimerRef.current != null) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (watchdogRef.current != null) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      if (connectingRef.current) return;
      connectingRef.current = true;
      const generation = ++generationRef.current;
      setOffline(false);
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        if (generation !== generationRef.current) return;
        const isReconnect = retryRef.current > 0;
        retryRef.current = 0;
        setReconnecting(false);
        setConnected(true);
        connectingRef.current = false;
        lastInboundRef.current = Date.now();
        if (isReconnect) reportRecoverySignal("realtime_reconnect", 1);
        clearLiveTimers();
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }));
            } catch {
              /* send failure surfaces via onclose/onerror */
            }
          }
        }, PING_EVERY_MS);
        watchdogRef.current = setInterval(() => {
          if (Date.now() - lastInboundRef.current > STALE_MS) {
            reportRecoverySignal("heartbeat_timeout", 1);
            // No traffic within the window → treat as dead/half-open and recycle the socket.
            try {
              ws.close();
            } catch {
              /* onclose handles reconnect */
            }
          }
        }, WATCHDOG_EVERY_MS);
      };

      ws.onmessage = (event) => {
        if (generation !== generationRef.current) return;
        lastInboundRef.current = Date.now();
        const raw = String(event.data ?? "");
        // Liveness control frames: answer server PING with PONG, drop PONG, never forward
        // either to consumers. Guarded by length so we don't parse real event payloads.
        if (raw.length < 80 && (raw.includes('"PING"') || raw.includes('"PONG"'))) {
          try {
            const type = (JSON.parse(raw) as { type?: string }).type;
            if (type === "PING") {
              try {
                ws.send(JSON.stringify({ type: "PONG", timestamp: new Date().toISOString() }));
              } catch {
                /* ignore */
              }
              return;
            }
            if (type === "PONG") return;
          } catch {
            /* not a control frame → forward as-is */
          }
        }
        onMessageRef.current?.(raw);
      };

      ws.onclose = () => {
        if (generation !== generationRef.current) return;
        clearLiveTimers();
        setConnected(false);
        connectingRef.current = false;
        if (cancelled) return;
        const retry = Math.min(30_000, 1_000 * 2 ** retryRef.current);
        retryRef.current += 1;
        setReconnecting(true);
        timerRef.current = setTimeout(connect, retry);
      };

      ws.onerror = () => {
        connectingRef.current = false;
        ws.close();
      };
    };

    connect();

    const onAppState = (next: AppStateStatus) => {
      if (next === "active" && (!socketRef.current || socketRef.current.readyState > WebSocket.OPEN)) {
        connect();
      }
    };
    const sub = AppState.addEventListener("change", onAppState);
    const unsubNet = onConnectivityReconnect(() => {
      if (!cancelled && enabled && url) connect();
    });

    return () => {
      cancelled = true;
      sub.remove();
      unsubNet();
      if (timerRef.current != null) clearTimeout(timerRef.current);
      clearLiveTimers();
      connectingRef.current = false;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled, url]);

  const send = useCallback((data: unknown): boolean => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      ws.send(payload);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { connected, reconnecting, offline, send };
}
