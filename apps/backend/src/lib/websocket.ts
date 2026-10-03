import { randomBytes } from "crypto";
import { JWTService } from "@/services/jwt.service";
import { redisClient } from "@/lib/redis";
import { incCounter } from "@/lib/metrics";
import { logger } from "@/lib/logger";

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
  /**
   * Revocable identity. Room membership is granted by a point-in-time check at `open()`; these
   * fields let that grant be withdrawn later (reassignment, suspension, session revocation,
   * token expiry) instead of living until the client decides to disconnect.
   */
  jti?: string;
  /** Access-token `exp` (unix seconds). The socket must not outlive the credential it was opened with. */
  tokenExp?: number;
  close?: (code: number, reason: string) => void;
}

/** Close codes the clients understand: 4401 → refresh credentials and reconnect, 4403 → do not reconnect. */
export const WS_CLOSE_UNAUTHORIZED = 4401;
export const WS_CLOSE_FORBIDDEN = 4403;

export type EvictionCriteria = {
  userId: string;
  /** Limit to these rooms; the connection is closed only when it has no room left. Omit = everywhere. */
  roomIds?: string[];
  /** Only connections opened with this token. */
  jti?: string;
  code: number;
  reason: string;
};

/** Redis channel carrying cross-instance WebSocket fan-out envelopes. */
const WS_FANOUT_CHANNEL = "ws:fanout";

/**
 * Optional audience filter for a room broadcast (X-29): one room can hold a customer and a partner,
 * and some frames carry fields only one of them may read. Carried in the fan-out envelope so a peer
 * instance applies the same filter.
 */
export type RoomAudience = { onlyUserType?: WSConnection["userType"]; exceptUserType?: WSConnection["userType"] };

function inAudience(connection: WSConnection, audience?: RoomAudience): boolean {
  if (!audience) return true;
  if (audience.onlyUserType && connection.userType !== audience.onlyUserType) return false;
  if (audience.exceptUserType && connection.userType === audience.exceptUserType) return false;
  return true;
}

export type FanoutEnvelope =
  | { kind: "room"; origin: string; roomId: string; message: WSMessage; audience?: RoomAudience }
  | { kind: "user"; origin: string; userId: string; message: WSMessage }
  | { kind: "evict"; origin: string; criteria: EvictionCriteria };

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

    logger.debug("ws_room_joined", { userId: connection.userId, roomId, size: room.size });
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
    logger.debug("ws_room_left", {
      userId: connection.userId,
      roomId,
      remaining: this.rooms.get(roomId)?.size || 0,
    });
  }

  getRoom(roomId: string): Set<WSConnection> {
    return this.rooms.get(roomId) || new Set();
  }

  getUserConnections(userId: string): Set<WSConnection> {
    return this.userConnections.get(userId) || new Set();
  }

  /** Deliver to this instance's local connections only (no fan-out). */
  private localBroadcast(roomId: string, message: WSMessage, audience?: RoomAudience): number {
    const room = this.getRoom(roomId);
    let successCount = 0;
    room.forEach((connection) => {
      if (!inAudience(connection, audience)) return;
      try {
        connection.send(JSON.stringify(message));
        successCount++;
      } catch (error) {
        console.error(`[Broadcast] Failed to send to ${connection.connectionId}:`, error);
      }
    });
    return successCount;
  }

  /**
   * Deliver to this instance's members AND to every peer instance.
   *
   * The fan-out publish is unconditional. It used to be skipped when the LOCAL room was empty
   * (`if (roomSize === 0) return 0` before the publish), which is only correct on a single instance:
   * room membership is per-instance, so an empty room here says nothing about whether a peer is
   * holding the subscriber. On two instances that shortcut silently dropped every room broadcast
   * produced on the node that happened not to host a member — measured as 0 of 1 `BOOKING_STATUS`
   * frames delivered while the `sendToUser` envelope for the same transition arrived normally,
   * because `sendToUser` never had the shortcut.
   *
   * The rooms without a per-user fallback were the ones that lost the most: `admin:ops` alerts,
   * `tracking:{bookingId}` and `geofence:{key}` are broadcast-only, so for them the shortcut meant
   * the event simply never left the producing node.
   *
   * A PUBLISH with no subscribers is O(1) in Redis and delivers nothing, so the cost of always
   * publishing is one round trip on a path that already performs one for every `sendToUser`.
   */
  broadcast(roomId: string, message: WSMessage, audience?: RoomAudience): number {
    const roomSize = this.getRoom(roomId).size;
    const successCount = this.localBroadcast(roomId, message, audience);
    if (successCount > 0) {
      logger.debug("ws_broadcast", { type: String(message.type), roomId, delivered: successCount, roomSize });
    }
    void redisClient.publish(
      WS_FANOUT_CHANNEL,
      JSON.stringify({ kind: "room", origin: this.instanceId, roomId, message, ...(audience ? { audience } : {}) } as FanoutEnvelope),
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
      logger.debug("ws_send_to_user", { type: String(message.type), userId, connections: successCount });
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
        this.applyFanoutEnvelope(env);
      } catch (err) {
        console.error("[WS Fanout] bad envelope:", err);
      }
    });
    if (!unsub) return false;
    this.fanoutUnsub = unsub;
    logger.info("ws_fanout_subscribed", { instanceId: this.instanceId });
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

  /** Apply a peer instance's envelope to local connections. Own echoes are ignored. Exposed for tests. */
  applyFanoutEnvelope(env: FanoutEnvelope): void {
    if (!env || env.origin === this.instanceId) return;
    if (env.kind === "room") this.localBroadcast(env.roomId, env.message, env.audience);
    else if (env.kind === "user") this.localSendToUser(env.userId, env.message);
    else if (env.kind === "evict") this.localEvict(env.criteria);
  }

  /**
   * Withdraw a user's room membership on this instance. With `roomIds` only those rooms are left and
   * the socket is closed once it has no room left (a booking socket lives in exactly one room, a
   * notifications socket keeps its `user:` room); without, every room is left and the socket closed.
   * Returns the number of connections closed locally.
   */
  private localEvict(criteria: EvictionCriteria): number {
    const connections = Array.from(this.getUserConnections(criteria.userId));
    let closed = 0;
    for (const conn of connections) {
      if (criteria.jti && conn.jti !== criteria.jti) continue;
      const targetRooms = criteria.roomIds
        ? criteria.roomIds.filter((r) => conn.rooms.has(r))
        : Array.from(conn.rooms);
      if (targetRooms.length === 0) continue;
      for (const roomId of targetRooms) this.removeFromRoom(roomId, conn);
      if (conn.rooms.size === 0) {
        this.connectionMap.delete(conn.connectionId);
        try {
          conn.close?.(criteria.code, criteria.reason);
        } catch {
          /* already gone */
        }
        closed++;
      }
    }
    if (closed > 0 || connections.length > 0) {
      incCounter("websocket_evictions_total", { reason: criteria.reason });
      logger.info("ws_evicted", {
        userId: criteria.userId,
        rooms: criteria.roomIds ?? "all",
        reason: criteria.reason,
        closed,
      });
    }
    return closed;
  }

  /**
   * Withdraw a user's room membership everywhere: locally now, and on every peer instance via the
   * fan-out channel (membership is per instance, so eviction has to travel the same way frames do).
   */
  evictUser(criteria: EvictionCriteria): number {
    const closed = this.localEvict(criteria);
    void redisClient.publish(
      WS_FANOUT_CHANNEL,
      JSON.stringify({ kind: "evict", origin: this.instanceId, criteria } as FanoutEnvelope),
    );
    return closed;
  }

  /**
   * Close every socket whose access token has expired. A socket is opened with a credential that
   * expires; the transport must not extend that credential. Local only — every instance sweeps its
   * own sockets. Returns the number closed.
   */
  sweepExpiredTokens(nowSec = Math.floor(Date.now() / 1000)): number {
    let closed = 0;
    for (const conn of Array.from(this.connectionMap.values())) {
      if (conn.tokenExp == null || conn.tokenExp > nowSec) continue;
      closed += this.localEvict({
        userId: conn.userId,
        jti: conn.jti,
        code: WS_CLOSE_UNAUTHORIZED,
        reason: "token_expired",
      });
    }
    return closed;
  }

  private expirySweep: ReturnType<typeof setInterval> | null = null;

  startTokenExpirySweep(intervalMs = 30_000): void {
    if (this.expirySweep) return;
    this.expirySweep = setInterval(() => {
      try {
        this.sweepExpiredTokens();
      } catch (err) {
        logger.error("ws_expiry_sweep_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }, intervalMs);
    this.expirySweep.unref?.();
  }

  stopTokenExpirySweep(): void {
    if (this.expirySweep) clearInterval(this.expirySweep);
    this.expirySweep = null;
  }

  removeAllUserConnections(userId: string, reason = "removed"): void {
    this.localEvict({ userId, code: WS_CLOSE_FORBIDDEN, reason });
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
