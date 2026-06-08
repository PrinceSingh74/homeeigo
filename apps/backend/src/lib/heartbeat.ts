import { MessageType } from "@/lib/websocket";

export class HeartbeatManager {
  private intervals = new Map<string, NodeJS.Timer>();
  private timeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Keepalive ping every 30s. Intentionally does NOT force-close on a missing
   * PONG: the browser clients (useRealtimeChannel) don't auto-reply to a
   * server PING, so a PONG-timeout kill would force-disconnect healthy
   * connections every ~40s (reconnect churn). The dead-socket case is handled
   * by the transport: `connection.send` throws once the socket is gone, which
   * self-stops this interval. Client-initiated PING is still answered with a
   * PONG by the route message handlers.
   */
  startHeartbeat(connectionId: string, connection: any): void {
    const interval = setInterval(() => {
      try {
        connection.send(
          JSON.stringify({
            type: MessageType.PING,
            timestamp: new Date(),
          })
        );
      } catch {
        // Socket already closed → stop the keepalive and clean up.
        this.stopHeartbeat(connectionId);
      }
    }, 30000);

    this.intervals.set(connectionId, interval);
  }

  handlePong(connectionId: string): void {
    const timeout = this.timeouts.get(connectionId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(connectionId);
    }
  }

  stopHeartbeat(connectionId: string): void {
    const interval = this.intervals.get(connectionId);
    const timeout = this.timeouts.get(connectionId);

    if (interval) clearInterval(interval);
    if (timeout) clearTimeout(timeout);

    this.intervals.delete(connectionId);
    this.timeouts.delete(connectionId);
  }

  stopAll(): void {
    this.intervals.forEach((interval) => clearInterval(interval));
    this.timeouts.forEach((timeout) => clearTimeout(timeout));
    this.intervals.clear();
    this.timeouts.clear();
  }
}

export const heartbeatManager = new HeartbeatManager();
