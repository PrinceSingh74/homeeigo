# P2 — Sentry Validation Evidence (Phase 6)

**Date:** 2026-06-08 · **SDK:** `@sentry/bun@10.56` · **Runner:** `bun run p2:sentry` (`scripts/p2-sentry-verify.ts`) · **Path:** the real wired path (`observability.init` → `observability.captureException` → `observability.flush`), i.e. the same function the error middleware calls on 5xx/DB-503.

## Configuration
`SENTRY_DSN` set in the gitignored `apps/backend/.env` (project `4511531256971264`, region `us`). `observability.init()` loads `@sentry/bun` lazily and enables reporting (no-op without DSN — dev behaviour unchanged otherwise).

## Injected event
`new Error("HOMIGO_P2_TEST_EXCEPTION")` captured with tags `category=payment`, `level=error`, `path=/p2/sentry-test`, and extra `marker=P2_FINAL_CERTIFICATION`.

## Result (live run)
```
✅ Sentry enabled (SDK loaded)
  event id : 83708cfa785e4090838704682ada675f
  flushed  : true        (true = transmitted to Sentry ingest within 8s)
  timestamp: 2026-06-08T18:43:55.032Z
✅ Phase 6: PASS — event delivered
```

| Check | Value |
|---|---|
| SDK initialised | ✅ (`observability.isEnabled === true`) |
| Event ID returned | `83708cfa785e4090838704682ada675f` |
| Stack trace | captured from the thrown `Error` (full JS stack) |
| Transmitted to ingest | ✅ `flush(8000) === true` |

> Proof basis: `@sentry/bun`'s `flush()` returns `true` only when buffered events were successfully sent to Sentry's ingest endpoint within the timeout. Combined with the returned event id, this confirms delivery. Locate event `83708cfa785e4090838704682ada675f` in the Sentry project to see the stack trace + tags in the UI.

## Status
**Phase 6: PASS** — exception captured, stack trace attached, transmitted to Sentry (event id + successful flush). Re-runnable via `bun run p2:sentry`.

> Note: with `SENTRY_DSN` set, dev errors now also flow to Sentry. Remove the line from `.env` if you want dev to stay console-only.
