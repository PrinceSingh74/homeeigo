# HOMIGO Phase 3 — Final Provider Certification

**Date:** 2026-08-10 · **HEAD:** `48b3d61626dc80e916c7e27c4d8e2350ebf77245`
**Branch:** `cursor/stage-e-step-13-certification` · **Architecture:** [ADR-019](../architecture/adr-019-phase-3-ai-gateway-integration.md)

> **Superseded in part.** The provider set described below (Gemini primary, OpenAI
> fallback) changed on the same date: Anthropic Claude is now the primary provider with
> Gemini and OpenAI retained as ordered fallbacks. Sections 2–7, 17 and 21 describe the
> two-provider arrangement and no longer reflect the routing contract. Everything else —
> security, rate limiting, observability, Phase 0/1/2 status, production safety — still
> holds. See [ANTHROPIC_PROVIDER_CERTIFICATION.md](./ANTHROPIC_PROVIDER_CERTIFICATION.md)
> and [ADR-020](../architecture/adr-020-multi-provider-ai-chain.md).

---

## 1. Executive Result

**FINAL VERDICT: B — READY WITH LIMITATIONS**

Every gate that can be executed in this environment passes. The three headline gates —
live Gemini success, live OpenAI success, and a successful fallback — remain
**NOT VERIFIED** because no provider credential is reachable from the certification
runtime. They are not simulated, not inferred, and not marked PASS.

The fallback *branch* is runtime-proven (see §5). Fallback *success* is not, because
success requires a real OpenAI key.

## 2. Credential Configuration Status

| Variable | Status |
| --- | --- |
| `GEMINI_API_KEY` | **NOT CONFIGURED** |
| `OPENAI_API_KEY` | **NOT CONFIGURED** |
| `GOOGLE_APPLICATION_CREDENTIALS` | **NOT CONFIGURED** |

Locations checked (presence only — no value was ever read, printed or logged):

| Location | Result |
| --- | --- |
| `apps/backend/.env`, `.env.local`, `.env.production`, `.env.staging`, `.env.test` | 0 provider-key lines each |
| `apps/web/.env.local`, `apps/admin-panel/.env.local` | 0 provider-key lines each |
| Windows environment — Process scope | empty |
| Windows environment — User scope | empty |
| Windows environment — Machine scope | empty |
| Newest `.env*` modification time | 2026-08-04 (nothing changed on the certification date) |

### Why this is likely happening

Credentials set in an interactive shell do not reach the certification runtime. This was
observed repeatedly during this work: both `EVENTS_TRACKING_ENABLED` and a test
`OPENAI_API_KEY` failed to propagate to background-spawned processes even when exported.

**To make them visible**, put them where the app itself reads configuration:

```bash
# apps/backend/.env.local  (already git-ignored — verify before adding)
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

Then re-run the certification (§20). No code change is required — the gateway already
reads both from the environment.

## 3. Gemini Live Certification — **NOT VERIFIED**

No credential. What *is* proven:

| Property | Evidence |
| --- | --- |
| Adapter is invoked as primary | `homigo_ai_provider_usage{provider="GEMINI",status="failure"}` **+2** on one request |
| Attempt count is bounded | exactly 2 = 1 call + 1 retry, matching `routeModelRequest` |
| Failure is classified, not swallowed | request proceeded to fallback rather than erroring out |

**Not proven:** a successful Gemini response, output validation on real content, token usage.

## 4. OpenAI Live Certification — **NOT VERIFIED**

No credential. What *is* proven:

| Property | Evidence |
| --- | --- |
| Adapter is invoked as fallback | `homigo_ai_provider_usage{provider="OPENAI",status="failure"}` **+1** |
| Invoked only after Gemini exhausted | ordering implied by the fallback counter below |

**Not proven:** a successful OpenAI response, token usage.

## 5. Gemini → OpenAI Fallback — **PATH: PASS · SUCCESS: NOT VERIFIED**

One real gateway request with both providers configured (deliberately invalid keys),
metric deltas captured before/after:

```
homigo_ai_provider_usage{provider="GEMINI",status="failure"}      +2
homigo_ai_provider_usage{provider="OPENAI",status="failure"}      +1
homigo_ai_fallback_total{from="GEMINI",to="OPENAI"}               +1
homigo_ai_failures_total{reason="PROVIDER_ERROR",role="PARTNER"}  +1
```

This is the router contract executing exactly as written: **Gemini ×2 → OpenAI ×1 →
normalized error. No retry storm.**

The customer path then degraded with `degradedReason: PROVIDER_ERROR` — distinct from
`PROVIDERS_UNCONFIGURED` — proving the request traversed gateway → router → both
providers before degrading.

**What is missing:** OpenAI returning a real answer. That requires a valid key, so
"customer receives an OpenAI-generated response" is **NOT VERIFIED**.

## 6. Token Usage — **NOT VERIFIED**

No successful live call, so no real token counts exist. None were fabricated.

## 7. Cost — **NOT VERIFIED**

No billed tokens. `computeTokenCost` and `homigo_ai_cost` exist and are wired, but with
zero real usage there is nothing to certify. No pricing was invented.

## 8. Customer E2E — **PASS (degraded)**

```
mode           = deterministic_fallback
degradedReason = PROVIDER_ERROR
provider       = (absent — omitted, not faked)
fixture leak   = false
quickActions   = present
```

Full chain traversed: authorization → gateway → context → prompt → router → providers →
normalized failure → honest degradation. Conversation persisted; `trace_id` present on
4/4 audited requests.

**NOT VERIFIED:** a customer response generated by a real model.

## 9. Partner Web E2E — **PASS (degraded)**

Authorization and RBAC enforced; gateway reached; provider attempted; error normalized to
`PROVIDER_ERROR` 502; client labels the answer offline. **NOT VERIFIED:** real model content.

## 10. Partner Mobile — **NOT VERIFIED**

No physical device available. Static secret hygiene **PASS** (§11).

## 11. Security — **PASS**

| Check | Result |
| --- | --- |
| Unauthenticated | 401 |
| Customer → admin AI | 403 |
| Partner → admin AI | 403 |
| Customer → partner AI | 403 |
| Partner → customer AI | 403 |
| Injection probes (runtime) | **5/5 blocked** |
| Injection probes (unit) | **11/11 blocked** |
| Benign prompts | **10/10 allowed** (no overblocking) |
| Error leakage — key / auth header / provider host / stack / fs path | **0/5 leaked** |
| Provider secret in any client source (5 roots) | **0** |
| Client request to a provider domain | **0** |
| Single logical entry (structural regression) | **12/12** |

Critical failures: **0**.

## 12. Rate Limiting — **PASS**

60 concurrent requests → **39 × HTTP 429**, remainder reached the provider stage.
Rejections carry a rate-limit code. No race allowed unlimited passage.

## 13. Observability — **PASS**

- 16 `homigo_ai_*` series live on `/metrics`
- Metric deltas correctly attributed to real provider attempts (§5)
- Audit: 4/4 certification requests persisted, **4/4 with `trace_id`**, 4/4 with
  `error_code = PROVIDER_ERROR`
- Blocked decisions recorded in `ai_activity_timeline` (149 blocked, each with the exact
  triggering pattern as `block_reason`)

Audit is deliberately split: `ai_gateway_requests` for requests that reached the provider
stage, `ai_activity_timeline` for pre-provider policy blocks.

## 14. Phase 0 — **PASS**

`outbox_over_cap=0` · `outbox_pending=0` · `legacy_eta_24h=0` · `dlq` reachable.

## 15. Phase 1 — **NOT VERIFIED**

BigQuery unreachable: no GCP credentials in this environment. External dependency —
requires a service account with BigQuery access to the `homigo-497619` project. Nothing
was modified to manufacture a pass.

## 16. Phase 2 — **PASS**

30/30 assertions. All **7 frozen SHAs MATCH**. `inverted_ts=0`. ETA ML inference **OFF**
(0 model calls on booking/tracking paths). Google Maps remains the customer-facing ETA.

## 17. Latency

| Path | Measurement |
| --- | --- |
| Customer degraded (no provider) | p50 **43 ms** · p95 **86 ms** (n=20) |
| Gemini ×2 fail → OpenAI fail → normalized | **11,898 ms** (n=1) |
| Gemini live success | NOT MEASURED |
| OpenAI live success | NOT MEASURED |
| Fallback success | NOT MEASURED |

No SLO exists; none invented. **Worth a product decision:** a full provider outage costs
the customer ~12 s before the degraded answer arrives.

## 18. Production Safety — **NONE**

| Check | Result |
| --- | --- |
| Production database | not accessed, not modified |
| Bookings | 297 before and after |
| Real training-eligible labels | 0/50, unchanged |
| Production credentials | not modified |
| Event flags / migrations / infra | untouched |
| Test credentials written to any repo file | **0** (repo-wide scan) |

All provider tests ran against a local dev instance with keys held in process memory only.

## 19. Remaining Limitations

1. **No provider credentials reachable** — blocks Gemini live, OpenAI live, fallback
   success, token usage and cost. **This is the sole blocker between B and A.**
2. **Phase 1 / BigQuery NOT VERIFIED** — no GCP credentials.
3. **Partner mobile runtime NOT VERIFIED** — no device.
4. **Timeout classification source-verified only** — invalid keys produce auth failures,
   not timeouts (`timeout_total` +0).
5. **83 pre-existing backend type errors** in the AI subsystems, surfaced when a broken
   typecheck harness was repaired during this work. None on lines changed by Phase 3.
6. **~12 s worst-case failure latency** on total provider outage.

## 20. Evidence Index

| Artifact | Purpose |
| --- | --- |
| `phase3_runtime.ts` | Live HTTP certification — 26 pass / 0 fail / 1 not verified |
| `phase3_assert.ts` | In-process gateway assertions — 23/23 |
| `phase3_bypass.ts` | Structural regressions (single-entry, routes, secrets) — 12/12 |
| `provider_scenario.ts` | Per-process provider scenarios with fixed env |
| `eta-assert.ts` | Phase 2 regression — 30/30 |

Scripts live in the session scratchpad, not the repo — they are certification tooling,
not product code.

**To complete this certification:** add both keys to `apps/backend/.env.local`, restart
the backend, then re-run `phase3_runtime.ts` and the provider scenarios. Nothing else is
outstanding.

## 21. Final Certification Matrix

| Gate | Result |
| --- | --- |
| Gemini live success | **NOT VERIFIED** |
| OpenAI live success | **NOT VERIFIED** |
| Gemini → OpenAI fallback (path) | **PASS** |
| Gemini → OpenAI fallback (success) | **NOT VERIFIED** |
| Both providers unavailable | **PASS** |
| Token usage | **NOT VERIFIED** |
| Cost | **NOT VERIFIED** |
| Customer E2E | **PASS (degraded)** |
| Partner Web E2E | **PASS (degraded)** |
| Partner Mobile | **NOT VERIFIED** |
| Security | **PASS** |
| Rate limiting | **PASS** |
| Observability | **PASS** |
| Phase 0 | **PASS** |
| Phase 1 | **NOT VERIFIED** |
| Phase 2 | **PASS** |
| Google ETA | **UNCHANGED** |
| ETA ML inference | **OFF** |
| Production mutation | **NONE** |

## 22. Final Verdict

```
========================================
HOMIGO PHASE 3
FINAL PROVIDER CERTIFICATION

FINAL VERDICT: B — READY WITH LIMITATIONS

BLOCKER: provider credentials are not
reachable from the certification runtime.
========================================
```

Verdict **A** requires Gemini live success, OpenAI live success and a successful fallback.
None can be produced without credentials, and none were simulated. Architecture, security,
reliability and observability all pass on their own merits.
