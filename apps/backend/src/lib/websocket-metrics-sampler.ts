/**
 * WebSocket lifecycle Prometheus gauges — sampled at scrape time.
 */
import { setGauge, registerScrapeSampler } from "./metrics";
import { roomManager } from "./websocket";

export function registerWebSocketMetricSamplers(): void {
  registerScrapeSampler(async () => {
    const stats = roomManager.getStats();
    setGauge("websocket_room_count", stats.totalRooms);
    setGauge("websocket_connection_count", stats.totalConnections);
  });
}
