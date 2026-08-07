# Phase 4 Enterprise AI Brain — API Documentation

Base path: `/api/ai` (extends Phase 3 routes)

All Phase 4 admin routes require `ADMIN` role JWT.

## Context

| Method | Path | Description |
|--------|------|-------------|
| POST | `/context` | Build enterprise context for a message |
| POST | `/context/rebuild` | Force-rebuild context (bypass cache) |
| GET | `/context/history` | List context snapshots for actor |
| GET | `/context/search` | Search snapshots by hash/actor/date |
| POST | `/context/cache/purge` | Purge expired context cache entries |

### POST /context

```json
{
  "message": "What's my booking status?",
  "intent": "tracking",
  "conversationId": "conv_abc",
  "context": { "bookingId": "bkg_xyz", "customerId": "usr_123" }
}
```

Response includes `systemContext`, `sections`, `contextHash`, `contextSize`, `tokenBudget`, `trimmed`.

## Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/memory` | Search/list memories |
| GET | `/memory/:key` | Retrieve specific memory |
| POST | `/memory` | Store/update memory |
| PATCH | `/memory/:id` | Update memory content |
| DELETE | `/memory/:id` | Archive memory |
| GET | `/memory/stats` | Memory statistics |

Memory types: `SESSION`, `CONVERSATION`, `BUSINESS`, `USER`, `PARTNER`, `ADMIN`, `OPERATIONAL`, `SEMANTIC`, `WORKING`, `HISTORICAL`

## Prompts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/prompts` | List prompt registry |
| GET | `/prompts/:promptId` | Get prompt with active version |
| POST | `/prompts` | Create new prompt (DRAFT) |

## Prompt Versions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/prompt-versions/:promptId` | List all versions |
| POST | `/prompt-versions` | Create new version |
| POST | `/prompt-versions/approve` | Approve version |
| POST | `/prompt-versions/rollback` | Rollback to version |

## Timeline

| Method | Path | Description |
|--------|------|-------------|
| GET | `/timeline?days=7` | Activity timeline + stats + prompt analytics |

## Conversation Memory

| Method | Path | Description |
|--------|------|-------------|
| POST | `/conversations/:id/summarize` | Generate conversation summary |
| POST | `/conversations/:id/pin` | Pin a fact to conversation |
| GET | `/conversations/recall?q=booking` | Recall past conversations |

## Phase 3 Routes (unchanged)

- POST `/gateway/chat`, `/customer`, `/partner`, `/admin`
- GET `/usage`, `/cost`, `/health`

Gateway automatically uses Enterprise Context Builder and Prompt Intelligence when `AI_BRAIN_ENABLED=true` (default).
