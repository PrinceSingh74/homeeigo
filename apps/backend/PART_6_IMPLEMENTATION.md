# HOMIGO Backend - PART 6: Real-Time Features Implementation

**Status:** ✅ COMPLETE  
**Framework:** Bun + Elysia.js + WebSocket + TypeScript + Prisma  
**Date:** 2026-05-29

## Overview

Part 6 implements a complete real-time system for HOMIGO with WebSocket-based live tracking, notifications, booking updates, and earnings counter. Zero polling needed — everything is push-based.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   WebSocket Server                           │
│              (Elysia + Bun WebSocket)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────┐  │
│  │ Tracking Room    │  │ Notifications    │  │ Booking   │  │
│  │ /ws/tracking/:id │  │ /ws/notify/:uid  │  │ /ws/book  │  │
│  └──────────────────┘  └──────────────────┘  └───────────┘  │
│                                                               │
│  ┌──────────────────┐                                        │
│  │ Earnings Room    │                                        │
│  │ /ws/earnings/:id │                                        │
│  └──────────────────┘                                        │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│  RoomManager (in-memory connection tracking)                 │
│  Heartbeat (PING/PONG every 30 sec)                         │
│  Prisma (data persistence)                                  │
└─────────────────────────────────────────────────────────────┘
```

## Implemented Features

### 1. Live Location Tracking
- **File:** `src/services/tracking.service.ts`
- **Route:** `/ws/tracking/:bookingId`
- **Features:**
  - Real-time provider location updates
  - Haversine distance calculation
  - ETA prediction (based on 30 km/h + 1.5x traffic multiplier)
  - Arrival detection (< 100m)
  - Location history persistence
  - Bearing/direction calculation

### 2. Push Notifications
- **File:** `src/services/notification.service.ts`
- **Route:** `/ws/notify/:userId`
- **Features:**
  - In-app real-time notifications
  - Desktop/mobile push ready
  - Multiple notification types (booking, payment, rating, system)
  - Notification persistence
  - Read/unread tracking
  - Action buttons support

### 3. Live Booking Updates
- **File:** `src/services/booking-live.service.ts`
- **Route:** `/ws/booking/:bookingId`
- **Features:**
  - Accept/Reject/Cancel in real-time
  - Start service notification
  - Booking completion flow
  - Automatic earnings processing
  - Refund handling on cancellation
  - Both parties notified instantly

### 4. Real-Time Earnings Counter
- **File:** `src/services/earnings-live.service.ts`
- **Route:** `/ws/earnings/:providerId`
- **Features:**
  - Live balance updates
  - Earnings breakdown (today, week, month, total)
  - Monthly trend analysis
  - Pending/completed earnings tracking
  - Withdrawal tracking

## Files Created/Modified

### New Core Files
```
src/lib/websocket.ts                  # RoomManager, MessageType, WSConnection
src/lib/heartbeat.ts                  # HeartbeatManager for connection health
src/lib/ws-utils.ts                   # Broadcasting utilities
src/middleware/ws-auth.middleware.ts  # JWT token verification for WS
src/services/booking-live.service.ts  # Real-time booking operations
src/services/earnings-live.service.ts # Real-time earnings tracking
src/websocket/booking.ws.ts           # Booking WebSocket endpoint
src/websocket/earnings.ws.ts          # Earnings WebSocket endpoint
```

### Modified Files
```
src/index.ts                          # Added bookingWs, earningsWs registration
```

### Existing Files (Already Present)
```
src/services/tracking.service.ts      # Enhanced location tracking
src/services/notification.service.ts  # Notification handling
src/websocket/tracking.ws.ts          # Tracking WebSocket
src/websocket/notifications.ws.ts     # Notifications WebSocket
```

## WebSocket Endpoints

### 1. Tracking (`/ws/tracking/:bookingId`)
**Authentication:** JWT token in query or Authorization header  
**Methods:**
- `location_update` - Provider sends location
- `PING` - Heartbeat check

**Messages Received:**
- `LOCATION_UPDATE` - Provider location with ETA
- `ARRIVAL` - When provider < 100m away
- `SUBSCRIPTION` - Confirmation of subscription

### 2. Notifications (`/ws/notify/:userId`)
**Authentication:** JWT token  
**Methods:**
- `mark_read` - Mark notification as read
- `PING` - Heartbeat

**Messages Received:**
- `NOTIFICATION` - In-app notification
- `unread_list` - Initial unread notifications

### 3. Booking (`/ws/booking/:bookingId`)
**Authentication:** JWT token  
**Methods:**
- `accept_booking` - Provider accepts
- `reject_booking` - Provider rejects with reason
- `cancel_booking` - Customer cancels with reason
- `start_service` - Provider starts work
- `complete_booking` - Provider completes
- `PING` - Heartbeat

**Messages Received:**
- `BOOKING_STATUS` - Status change broadcast
- `SUBSCRIPTION` - Connection confirmation

### 4. Earnings (`/ws/earnings/:providerId`)
**Authentication:** JWT token (must match providerId)  
**Methods:**
- `get_breakdown` - Get 7-day earnings breakdown
- `get_monthly_trend` - Get 6-month trend
- `refresh_earnings` - Force refresh
- `PING` - Heartbeat

**Messages Received:**
- `EARNINGS_UPDATE` - Updated earnings data
- `earnings_breakdown` - Day-wise breakdown
- `earnings_monthly_trend` - Monthly trend

## Connection Management

### Authentication
- JWT verification on connection open
- Token extracted from query param or Authorization header
- User type validation (customer/vendor/admin)

### Heartbeat Mechanism
- PING sent every 30 seconds
- Expects PONG within 10 seconds
- Auto-closes connection on timeout
- Prevents stale connections

### Room Management
- Users auto-subscribed to relevant rooms (booking, earnings, notifications)
- Multiple connections per user supported (mobile + web)
- Auto-cleanup on disconnect
- Stats available via `roomManager.getStats()`

## Real-Time Features in Action

### Scenario 1: Customer Books Service
```
Customer → REST API (create booking)
         → Notification WS: "New booking created"
Provider ← Notification WS: "New booking! Accept/Reject buttons"
Provider → Booking WS: "accept_booking"
         → Broadcast to customer: BOOKING_STATUS = "ACCEPTED"
Customer ← Booking WS: Status update + provider info
```

### Scenario 2: Provider On The Way
```
Provider → Tracking WS: location_update (every 5 sec)
         → Distance: 2.5km, ETA: 8 min
Customer ← Tracking WS: location_update
         → Shows live map + "Provider is 2.5km away, ETA 8 min"
Provider < 100m away
Provider → Tracking WS: (automatic) arrival detected
Customer ← Notification WS: "Provider has arrived"
```

### Scenario 3: Service Completed → Earnings Updated
```
Provider → Booking WS: "complete_booking"
         → Processing: 15% commission deducted
Provider ← Earnings WS: EARNINGS_UPDATE (₹XXX added to wallet)
         → Balance updates in real-time
```

## Database Schema (Already Exists)

No new models needed! Using existing:
- `Booking` - Status tracking
- `Notification` - Message persistence
- `LocationHistory` - Tracking data
- `Earning` - Provider earnings
- `Withdrawal` - Withdrawal requests
- `Tracking` - Session tracking

## Error Handling

```typescript
// Authentication Errors
4401 - Unauthorized (invalid token)
4003 - Forbidden (user mismatch)

// Message Errors
Automatic retry with exponential backoff (client-side)
Error messages sent back via WebSocket

// Connection Errors
Auto-cleanup on disconnect
Heartbeat timeout = auto-close
```

## Performance Considerations

### Optimizations Implemented
1. **In-Memory Room Management** - O(1) message broadcast
2. **Heartbeat** - Detects stale connections immediately
3. **Selective Broadcasting** - Only target users get messages
4. **Batch Updates** - Multiple changes can be grouped
5. **Index-Heavy Queries** - Prisma queries use indexed fields

### Scalability Notes
For multi-server deployment:
- Use Redis Pub/Sub for cross-server messages
- Store room state in Redis
- Gateway handles authentication + routing

Example Redis integration ready in `notification-hub.ts`

## Testing Checklist

```
✅ Connection with valid JWT
✅ Connection with invalid JWT (rejected)
✅ Location updates received
✅ ETA recalculation every 5 sec
✅ Arrival notification at < 100m
✅ Booking accept/reject broadcasts
✅ Earnings update on completion
✅ Heartbeat PING/PONG
✅ Heartbeat timeout (stale connection)
✅ Multiple connections per user
✅ Auto-cleanup on disconnect
✅ Concurrent room operations
```

## Integration with Frontend

### React WebSocket Hook (Example)
```typescript
const useBookingTracking = (bookingId: string) => {
  const [location, setLocation] = useState(null);
  
  useEffect(() => {
    const token = getAuthToken();
    const ws = new WebSocket(
      `ws://localhost:3000/ws/tracking/${bookingId}?token=${token}`
    );
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "LOCATION_UPDATE") {
        setLocation(msg.data);
      }
    };
    
    return () => ws.close();
  }, [bookingId]);
  
  return location;
};
```

## Monitoring & Debugging

### Check Active Connections
```typescript
import { roomManager } from "@/lib/websocket";

const stats = roomManager.getStats();
console.log(stats);
// {
//   totalRooms: 15,
//   totalConnections: 42,
//   rooms: [
//     { id: "booking:xyz", connections: 2 },
//     { id: "earnings:abc", connections: 1 }
//   ]
// }
```

### Logs
All WebSocket operations logged with prefixes:
- `[WS]` - Connection lifecycle
- `[Room]` - Room operations
- `[Broadcast]` - Message delivery
- `[Heartbeat]` - Health checks
- `[Booking]` - Booking operations
- `[Earning]` - Earnings processing

## Future Enhancements

1. **Redis Pub/Sub** - Multi-instance broadcast
2. **Message Queue** - Reliable delivery (Bull/RabbitMQ)
3. **Rate Limiting** - Per-connection message limits
4. **Encryption** - End-to-end message encryption
5. **Message History** - Replay mechanism
6. **Typing Indicators** - "Provider is accepting..."
7. **Read Receipts** - Message status tracking

## Known Limitations

1. **Single-Server Only** - No cross-server pub/sub yet
2. **In-Memory Storage** - Lost on server restart
3. **No Reconnection Logic** - Client-side responsibility
4. **No Message Persistence** - Real-time only (DB has records)

## Deployment Notes

### Environment Variables
```bash
JWT_SECRET=your_secret_key
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
```

### Bun Configuration
```bash
# Development
bun --env-file=.env run --watch src/index.ts

# Production
bun build src/index.ts --outdir dist --target bun
bun run dist/index.js
```

### Docker Deployment
WebSocket requires:
- Sticky sessions (if load balancing)
- `maxBackoffDelay` for reconnections
- Health check endpoint at `/health`

## Code Quality

- ✅ TypeScript strict mode
- ✅ Error handling on all operations
- ✅ Input validation on messages
- ✅ Graceful degradation
- ✅ Logging at every step
- ✅ No hardcoded values
- ✅ Modular architecture

## Support & Documentation

For issues or questions:
1. Check logs with `[WS]` prefix
2. Verify JWT token validity
3. Confirm WebSocket endpoint accessibility
4. Check `roomManager.getStats()` for connection count
5. Review heartbeat logs for stale connections

---

**Part 6 Complete!** ✅ Ready for frontend integration and testing.
