/** Global WebSocket channel registry for diagnostics export. */
export type WsChannelSnapshot = {
  label: string;
  connected: boolean;
  reconnecting: boolean;
  offline: boolean;
  lastUpdatedAt: string;
};

const channels = new Map<string, WsChannelSnapshot>();

export function registerWsChannel(
  label: string,
  state: Omit<WsChannelSnapshot, "label" | "lastUpdatedAt">,
): void {
  channels.set(label, { label, ...state, lastUpdatedAt: new Date().toISOString() });
}

export function unregisterWsChannel(label: string): void {
  channels.delete(label);
}

export function getWebSocketDiagnostics(): WsChannelSnapshot[] {
  return [...channels.values()];
}
