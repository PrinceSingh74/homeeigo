# Phase 4 AI Brain — Memory Design

## Memory Types

| Type | Purpose | Default TTL |
|------|---------|-------------|
| SESSION | Ephemeral session state | 1 hour |
| CONVERSATION | Conversation summaries | 7 days |
| BUSINESS | Business object snapshots | 1 hour |
| USER | User preferences/facts | 30 days |
| PARTNER | Partner state | 1 hour |
| ADMIN | Admin context cache | 1 hour |
| OPERATIONAL | Platform ops state | 1 hour |
| SEMANTIC | Pinned facts, entities | 30 days |
| WORKING | Active task context | 30 min |
| HISTORICAL | Archived reference | 90 days |

## Storage Model

- PostgreSQL `ai_memory` table
- Unique key: `(memoryKey, ownerId, memoryType)`
- JSON content with optional text summary for search
- Version incremented on update
- Soft archive via `isArchived` flag
- Hard expiry via `expiresAt` + background sweep

## Retrieval Ranking

1. Filter by owner, type, non-archived, non-expired
2. Sort by `importance DESC`, `freshness DESC`
3. Text search on summary + content JSON
4. Limit to `AI_MEMORY_SEARCH_LIMIT` (default 50)

## Integration Points

- Context Builder reads top-10 memories per request
- Conversation summarize writes CONVERSATION + SEMANTIC memory
- Pin fact writes SEMANTIC memory with importance 0.9

## Future (Phase 5)

- Vector embeddings for semantic similarity search
- Redis L1 cache for hot session memory
