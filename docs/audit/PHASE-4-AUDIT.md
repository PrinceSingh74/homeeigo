# Phase 4 Audit — Context + Memory + Prompt Intelligence

**Score: 85%** · **HEAD:** `b582ead` · Audit-only

## Summary

Broad and genuinely in use — 14,818 activity-timeline rows is not a demo. The context builder, role collectors, prompt registry, and versioning are all real. Two concerns: the memory engine looks under-wired (4 rows against 1,629 conversations), and several roadmap-named controls could not be evidenced.

## Runtime Evidence

```
conversations:     1629      messages:          3276
activity timeline: 14818     prompt registry:   10  (versions: 10)
ai memory:            4  <-- suspiciously low
context snapshots:    4
```

## Requirement Detail

**Context Builder pipeline — IMPLEMENTED.** `ai-brain/context/enterprise-context-builder.ts` with `role-context.ts` for role resolution and `brain-security.ts` for permission gating. The roadmap's User → Role → Intent → Permission → Data → LLM shape is present; the **Intent** step specifically was not traced end-to-end and is `NOT_VERIFIED`.

**Role collectors — IMPLEMENTED (6).** `customer-context`, `partner-context`, `admin-context`, plus `finance-context`, `operations-context`, `support-context`. Exceeds the roadmap's three.

**Conversation Memory — IMPLEMENTED, and correctly non-duplicative.** `ai-brain/memory/conversation-memory.ts` with `ai-brain/gateway/conversation-bridge.ts` extends the existing `AiConversation`/`AiMessage` models rather than creating parallel infrastructure. The roadmap explicitly asked for reuse; this complies.

**Memory engine — PARTIAL.** `ai-brain/memory/memory-engine.ts` and the `AiMemory` model exist, but only 4 rows against 1,629 conversations. Either memory writes are gated behind a rarely-hit path, or the engine is not wired into the main request flow. Worth confirming before relying on it.

**Memory TTL / priority / importance / confidence / archive / compression / search — NOT_VERIFIED.** The roadmap names these explicitly; no evidence was obtained.

**Context caching + snapshots — IMPLEMENTED / PARTIAL.** `context-cache.ts` with `AiContextCache`; `context-snapshot.ts` with 4 rows.

**Token budget enforcement — NOT_VERIFIED.**
**Context compression — NOT_VERIFIED.**
**Hallucination guard — NOT_VERIFIED.**

**Prompt Registry + versioning — IMPLEMENTED.** `prompts/prompt-registry.ts` and `prompts/prompt-versioning.ts`, backed by `AiPromptRegistry` (10) and `AiPromptVersion` (10). Approval / rollback / deprecation semantics were not exercised — `NOT_VERIFIED`.

**Prompt intelligence / A-B controls — NOT_VERIFIED.** `prompts/prompt-intelligence.ts` exists; experiment control not evidenced.

**AI activity timeline — IMPLEMENTED.** `AiActivityTimeline` at 14,818 rows — the most heavily exercised Phase 4 surface. A dedicated `phase4_ai_brain_trace_id` migration indicates trace correlation was added deliberately.

**Security + RBAC — IMPLEMENTED.** `ai-brain/security/brain-security.ts`.

**Admin console — IMPLEMENTED.** Five pages: `/ai-brain`, `/ai-brain/memory`, `/ai-brain/context`, `/ai-brain/timeline`, `/ai-brain/prompts`.

**Grafana — PARTIAL.** `homigo-ai-brain.json` authored, not mounted in the running stack. Three `ai_brain` alert references exist.

## Assessment

The observable surfaces (timeline, conversations, prompts) are healthy. The unobservable ones (memory semantics, token budget, hallucination guard) are exactly where an AI platform accumulates silent risk, and they are the ones I could not verify. They are recorded `NOT_VERIFIED` rather than assumed working.

## Gaps

| ID | Gap | Priority |
|---|---|---|
| P1-3 | ai-brain dashboard not deployed | P1 |
| P2-2 | Memory engine appears under-wired (4 rows) | P2 |
| P2-3 | Token budget / compression / hallucination guard unverified | P2 |
