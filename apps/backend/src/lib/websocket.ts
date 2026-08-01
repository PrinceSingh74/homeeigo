import { randomBytes } from "crypto";
import { JWTService } from "@/services/jwt.service";
import { redisClient } from "@/lib/redis";
import { incCounter } from "@/lib/metrics";

export enum MessageType {
  LOCATION_UPDATE = "LOCATION_UPDATE",
  ETA_UPDATE = "ETA_UPDATE",
  ARRIVAL = "ARRIVAL",
  NOTIFICATION = "NOTIFICATION",
  MESSAGE = "MESSAGE",
  BOOKING_NEW = "BOOKING_NEW",
  BOOKING_ACCEPTED = "BOOKING_ACCEPTED",
  BOOKING_REJECTED = "BOOKING_REJECTED",
  BOOKING_CANCELLED = "BOOKING_CANCELLED",
  BOOKING_COMPLETED = "BOOKING_COMPLETED",
  BOOKING_STATUS = "BOOKING_STATUS",
  EARNINGS_UPDATE = "EARNINGS_UPDATE",
  PAYMENT_RECEIVED = "PAYMENT_RECEIVED",
  WITHDRAWAL_INITIATED = "WITHDRAWAL_INITIATED",
  PING = "PING",
  PONG = "PONG",
  SUBSCRIBE = "SUBSCRIBE",
  UNSUBSCRIBE = "UNSUBSCRIBE",
  ERROR = "ERROR",
}

export interface WSMessage {
  type: MessageType | string;
  data: any;
  timestamp: Date;
  sender?: {
    userId: string;
    userType: string;
  };
}

export interface WSConnection {
  userId: string;
  userType: "customer" | "vendor" | "admin";
  connectionId: string;
  connectedAt: Date;
  lastPing: Date;
  rooms: Set<string>;
  send: (message: string) => void;
}

/** Redis channel carrying cross-instance WebSocket fan-out envelopes. */
const WS_FANOUT_CHANNEL = "ws:fanout";

type FanoutEnvelope =
  | { kind: "room"; origin: string; roomId: string; message: WSMessage }
  | { kind: "user"; origin: string; userId: string; message: WSMessage };

export class RoomManager {
  private rooms = new Map<string, Set<WSConnection>>();
  private userConnections = new Map<string, Set<WSConnection>>();
  private connectionMap = new Map<string, WSConnection>();
  // Unique per process; lets us ignore our own fan-out echoes (no double delivery).
  private readonly instanceId = `inst_${randomBytes(6).toString("hex")}`;
  private fanoutUnsub: (() => Promise<void>) | null = null;

  addToRoom(roomId: string, connection: WSConnection): void {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    const room = this.rooms.get(roomId)!;
    if (room.has(connection)) {
      incCounter("websocket_duplicate_join_total", { room: roomId });
      return;
    }
    room.add(connection);

    if (!this.userConnections.has(connection.userId)) {
      this.userConnections.set(connection.userId, new Set());
    }
    this.userConnections.get(connection.userId)!.add(connection);

    connection.rooms.add(roomId);
    this.connectionMap.set(connection.connectionId, connection);

    console.log(
      `[Room] ${connection.userId} joined ${roomId} (total: ${room.size})`
    );
  }

  removeAllRooms(connection: WSConnection): void {
    const roomsArray = Array.from(connection.rooms);
    roomsArray.forEach((roomId) => {
      this.removeFromRoom(roomId, connection);
    });
    this.connectionMap.delete(connection.connectionId);
  }

  getConnectionById(connectionId: string): WSConnection | undefined {
    return this.connectionMap.get(connectionId);
  }

  removeFromRoom(roomId: string, connection: WSConnection): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.delete(connection);
      // Prune empty room set so the rooms Map doesn't grow unbounded.
      if (room.size === 0) this.rooms.delete(roomId);
    }
    connection.rooms.delete(roomId);

    // When this connection is no longer in any room, drop all of its tracking.
    if (connection.rooms.size === 0) {
      const userSet = this.userConnections.get(connection.userId);
      if (userSet) {
        userSet.delete(connection);
        if (userSet.size === 0) this.userConnections.delete(connection.userId);
      }
      this.connectionMap.delete(connection.connectionId);
    }
    console.log(
      `[Room] ${connection.userId} left ${roomId} (remaining: ${this.rooms.get(roomId)?.size || 0})`
    );
  }

  getRoom(roomId: string): Set<WSConnection> {
    return this.rooms.get(roomId) || new Set();
  }

  getUserConnections(userId: string): Set<WSConnection> {
    return this.userConnections.get(userId) || new Set();
  }

  /** Deliver to this instance's local connections only (no fan-out). */
  private localBroadcast(roomId: string, message: WSMessage): number {
    const room = this.getRoom(roomId);
    let successCount = 0;
    room.forEach((connection) => {
      try {
        connection.send(JSON.stringify(message));
        successCount++;
      } catch (error) {
        console.error(`[Broadcast] Failed to send to ${connection.connectionId}:`, error);
      }
    });
    return successCount;
  }

  broadcast(roomId: string, message: WSMessage): number {
    const roomSize = this.getRoom(roomId).size;
    if (roomSize === 0) return 0;
    const successCount = this.localBroadcast(roomId, message);
    if (successCount > 0) {
      console.log(
        `[Broadcast] ${message.type} sent to ${successCount}/${roomSize} in ${roomId}`
      );
    }
    void redisClient.publish(
      WS_FANOUT_CHANNEL,
      JSON.stringify({ kind: "room", origin: this.instanceId, roomId, message } as FanoutEnvelope),
    );
    return successCount;
  }

  /** Deliver to this instance's local connections for a user only (no fan-out). */
  private localSendToUser(userId: string, message: WSMessage): number {
    const connections = this.getUserConnections(userId);
    let successCount = 0;
    connections.forEach((connection) => {
      try {
        connection.send(JSON.stringify(message));
        successCount++;
      } catch (error) {
        console.error(`[SendToUser] Failed to send to ${userId}:`, error);
      }
    });
    return successCount;
  }

  sendToUser(userId: string, message: WSMessage): void {
    const successCount = this.localSendToUser(userId, message);
    if (successCount > 0) {
      console.log(`[SendToUser] ${message.type} sent to ${userId} (${successCount} connections)`);
    }
    void redisClient.publish(
      WS_FANOUT_CHANNEL,
      JSON.stringify({ kind: "user", origin: this.instanceId, userId, message } as FanoutEnvelope),
    );
  }

  /**
   * Subscribe to the cross-instance fan-out channel. Messages this instance
   * originated are ignored (origin guard) so each connection is delivered to
   * exactly once. Safe + no-op when Redis is unavailable. Returns true if the
   * subscription was established (i.e. Redis is live).
   */
  async initRedisFanout(): Promise<boolean> {
    if (this.fanoutUnsub) return true;
    const unsub = await redisClient.subscribe(WS_FANOUT_CHANNEL, (raw) => {
      try {
        const env = JSON.parse(raw) as FanoutEnvelope;
        if (!env || env.origin === this.instanceId) return; // ignore our own echoes
        if (env.kind === "room") this.localBroadcast(env.roomId, env.message);
        else if (env.kind === "user") this.localSendToUser(env.userId, env.message);
      } catch (err) {
        console.error("[WS Fanout] bad envelope:", err);
      }
    });
    if (!unsub) return false;
    this.fanoutUnsub = unsub;
    console.log(`[WS Fanout] subscribed (instance ${this.instanceId})`);
    return true;
  }

  async stopRedisFanout(): Promise<void> {
    if (this.fanoutUnsub) {
      await this.fanoutUnsub();
      this.fanoutUnsub = null;
    }
  }

  /** Exposed for diagnostics/tests. */
  get instance(): string {
    return this.instanceId;
  }

  getStats() {
    return {
      totalRooms: this.rooms.size,
      totalConnections: Array.from(this.userConnections.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      rooms: Array.from(this.rooms.entries()).map(([id, connections]) => ({
        id,
        connections: connections.size,
      })),
    };
  }

  removeAllUserConnections(userId: string): void {
    const connections = this.userConnections.get(userId);
    if (connections) {
      const roomsToClean = new Set<string>();
      connections.forEach((conn) => {
        conn.rooms.forEach((room) => roomsToClean.add(room));
      });
      roomsToClean.forEach((room) => {
        connections.forEach((conn) => {
          this.removeFromRoom(room, conn);
        });
      });
      this.userConnections.delete(userId);
    }
  }
}

export const roomManager = new RoomManager();

export function generateConnectionId(): string {
  return `conn_${randomBytes(8).toString("hex")}`;
}

const jwtService = new JWTService();

export function verifyWSToken(url: string): {
  userId: string;
  userType: "customer" | "vendor" | "admin";
  email?: string;
} | null {
  try {
    const urlObj = new URL(url);
    const token = urlObj.searchParams.get("token");

    if (!token) {
      throw new Error("No token provided");
    }

    const decoded = jwtService.verifyAccessToken(token);
    if (!decoded?.userId) {
      throw new Error("Invalid token payload");
    }

    return {
      userId: decoded.userId,
      userType: decoded.userType ?? "customer",
      email: decoded.email,
    };
  } catch (error) {
    console.error("[WS Auth] Token verification failed:", error);
    return null;
  }
}
