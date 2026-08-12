"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitRecoverySignal } from "@/lib/telemetry/recovery";
import { isSystemWsPayload } from "@/lib/ws-system-frames";

type RealtimeOptions = {
  url: string | null;
  enabled?: boolean;
  /** When false, connection state changes do not rerender the subscriber (headless bridges). */
  trackConnectionState?: boolean;
  onMessage?: (event: MessageEvent<string>) => void;
};

export type RealtimeChannel = {
  connected: boolean;
  reconnecting: boolean;
  offline: boolean;
  send: (data: unknown) => boolean;
};

type SocketState = { connected: boolean; reconnecting: boolean; offline: boolean };

type SharedSocket = {
  url: string;
  ws: WebSocket | null;
  refs: number;
  retry: number;
  generation: number;
  timer: number | null;
  listeners: Set<(event: MessageEvent<string>) => void>;
  stateListeners: Set<(state: SocketState) => void>;
};

/**
 * ONE socket per URL, shared by every hook instance (same pattern as the
 * admin console). Before this, each useRealtimeChannel() call opened its own
 * WebSocket — pages mounting useActiveTracking in several components held
 * 4-6 parallel sockets per user (server rooms showed "total: 5-6").
 */
const sharedByUrl = new Map<string, SharedSocket>();

function readSocketState(ws: WebSocket | null): Pick<SocketState, "connected" | "reconnecting"> {
  if (!ws) return { connected: false, reconnecting: true };
  return {
    connected: ws.readyState === WebSocket.OPEN,
    reconnecting: ws.readyState === WebSocket.CONNECTING,
  };
}

function emitState(entry: SharedSocket, patch: Partial<SocketState> = {}) {
  const base = readSocketState(entry.ws);
  const state: SocketState = {
    connected: patch.connected ?? base.connected,
    reconnecting: patch.reconnecting ?? base.reconnecting,
    offline: patch.offline ?? false,
  };
  for (const fn of entry.stateListeners) fn(state);
}

function connectShared(entry: SharedSocket) {
  if (entry.ws && (entry.ws.readyState === WebSocket.OPEN || entry.ws.readyState === WebSocket.CONNECTING)) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    emitState(entry, { reconnecting: true, offline: true });
    if (entry.timer != null) window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => connectShared(entry), 2_000);
    return;
  }
  entry.generation += 1;
  const generation = entry.generation;
  emitState(entry, { offline: false, reconnecting: true, connected: false });
  const ws = new WebSocket(entry.url);
  entry.ws = ws;

  ws.onopen = () => {
    if (generation !== entry.generation) return;
    const wasReconnect = entry.retry > 0;
    entry.retry = 0;
    if (wasReconnect) emitRecoverySignal("realtime_reconnect", 1);
    emitState(entry, { connected: true, reconnecting: false, offline: false });
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === "string" ? event.data : String(event.data ?? "");
    if (isSystemWsPayload(data)) return;
    for (const fn of entry.listeners) fn(event as MessageEvent<string>);
  };

  ws.onclose = () => {
    if (generation !== entry.generation) return;
    entry.ws = null;
    emitState(entry, { connected: false, reconnecting: true });
    const retry = Math.min(30_000, 1_000 * 2 ** entry.retry);
    entry.retry += 1;
    if (entry.refs <= 0) return;
    if (entry.timer != null) window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => connectShared(entry), retry);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function acquireShared(url: string): SharedSocket {
  const existing = sharedByUrl.get(url);
  if (existing) {
    existing.refs += 1;
    // A previous release may have torn the socket down between unmount/remount
    // (StrictMode); make sure the shared connection is alive again.
    connectShared(existing);
    return existing;
  }
  const entry: SharedSocket = {
    url,
    ws: null,
    refs: 1,
    retry: 0,
    generation: 0,
    timer: null,
    listeners: new Set(),
    stateListeners: new Set(),
  };
  sharedByUrl.set(url, entry);
  connectShared(entry);
  return entry;
}

function releaseShared(url: string) {
  const entry = sharedByUrl.get(url);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (entry.timer != null) window.clearTimeout(entry.timer);
  entry.generation += 1;
  entry.ws?.close();
  entry.ws = null;
  sharedByUrl.delete(url);
}

function patchState(prev: SocketState, next: SocketState): SocketState | null {
  if (
    prev.connected === next.connected &&
    prev.reconnecting === next.reconnecting &&
    prev.offline === next.offline
  ) {
    return null;
  }
  return next;
}

/**
 * Native-WebSocket realtime channel with exponential-backoff reconnect.
 * Shares one socket per URL (StrictMode-safe). System PING/PONG never reach onMessage.
 */
export function useRealtimeChannel({
  url,
  enabled = true,
  trackConnectionState = true,
  onMessage,
}: RealtimeOptions): RealtimeChannel {
  const [state, setState] = useState<SocketState>({
    connected: false,
    reconnecting: false,
    offline: false,
  });
  const trackStateRef = useRef(trackConnectionState);
  trackStateRef.current = trackConnectionState;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const entryRef = useRef<SharedSocket | null>(null);

  useEffect(() => {
    if (!enabled || !url) return;
    const entry = acquireShared(url);
    entryRef.current = entry;

    const onMsg = (event: MessageEvent<string>) => onMessageRef.current?.(event);
    const onState = (next: SocketState) => {
      if (!trackStateRef.current) return;
      setState((prev) => patchState(prev, next) ?? prev);
    };

    entry.listeners.add(onMsg);
    entry.stateListeners.add(onState);
    onState({ ...readSocketState(entry.ws), offline: false });

    const onOnline = () => {
      if (!entry.ws || entry.ws.readyState > WebSocket.OPEN) connectShared(entry);
    };
    const onOffline = () => {
      if (!trackStateRef.current) return;
      setState((prev) => patchState(prev, { ...prev, offline: true, connected: false }) ?? prev);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      entry.listeners.delete(onMsg);
      entry.stateListeners.delete(onState);
      entryRef.current = null;
      releaseShared(url);
    };
  }, [enabled, url]);

  // Send through the LIVE shared socket — entry.ws survives reconnects; a
  // captured socket reference would go stale after the first reconnect.
  const send = useCallback((data: unknown): boolean => {
    const ws = entryRef.current?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      ws.send(payload);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { ...state, send };
}
