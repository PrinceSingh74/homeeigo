# HOMIGO Phase 3 — Anthropic Claude Primary Provider Certification

**Date:** 2026-08-10 · **Branch:** `cursor/stage-e-step-13-certification` · **HEAD at start:** `48b3d61`
**Architecture:** [ADR-020](../architecture/adr-020-multi-provider-ai-chain.md) · [Security](../security/PHASE-3-AI-GATEWAY-SECURITY.md)
**Supersedes the provider set in:** [FINAL_PROVIDER_CERTIFICATION.md](./FINAL_PROVIDER_CERTIFICATION.md)

---

## 1. Executive result

**VERDICT: B+ — INTEGRATION COMPLETE, LIVE PROVIDER PROVEN, LIVE CLAUDE STILL NOT VERIFIED**

Anthropic Claude is wired as the primary provider through the existing provider
abstraction. Gemini and OpenAI are fully retained and can still serve as primary.

**A real provider now answers real traffic.** A Gemini credential was supplied mid-run, and
with it: a live model response on the customer path (`mode = llm`), and a **live failover** —
Claude attempted and failed, Gemini answered, `fallbackUsed = true`. Runtime certification
moved from *26 pass / 0 fail / 1 not verified* to **27 pass / 0 fail / 0 not verified**.

A fourth provider, **Groq**, was then added as the tier that absorbs traffic when an
earlier provider runs out of quota — and that hand-off is proven live, on a genuinely
exhausted Gemini quota (§9).

Suites: **48/48 structural, 12/12 structural regressions, 23/23 gateway assertions,
27/0/0 runtime, 30/30 Phase 2 regression, 0 new type errors.**

**A real Claude API call was still not made** — `ANTHROPIC_API_KEY` is not present in any
reachable location. No Claude result was simulated, inferred, or presented as passing.

Enabling the credential surfaced **two real defects, both fixed** (§6a) — neither was
findable without a working key.

## 2. Credential status — presence only, no value ever read

| Location | `ANTHROPIC_API_KEY` |
| --- | --- |
| `apps/backend/.env` | absent |
| `apps/backend/.env.local` | absent |
| `apps/backend/.env.test` | absent |
| Windows environment — Process / User / Machine | absent in all three |

`apps/backend/.env.local` is covered by `apps/backend/.gitignore:10` (`.env.*`) — verified
with `git check-ignore`.

## 3. What changed

| Concern | Change |
| --- | --- |
| Enum | `ANTHROPIC` and `GROQ` appended to the `AiProviderType` Postgres enum |
| Config | `anthropic` block, `AI_PROVIDER_ORDER`, presence helpers, pricing, timeout |
| Adapters | `callAnthropic` (Messages API) and `callGroq` (shared OpenAI-compatible helper) — no SDK added |
| Router | Hardcoded Gemini→OpenAI replaced by an ordered 4-provider chain over `providerOrder` |
| Cost | `computeTokenCost` extended with Anthropic pricing |
| Health | Reports all three providers plus `primary` and `providerOrder` |
| Metrics | Provider label set and fallback pairs seeded for three providers |
| Guard | Customer degraded-mode guard is provider-agnostic (`isAnyProviderConfigured()`) |

**Nothing was removed.** Gemini and OpenAI keep their adapters, env vars, pricing, health
entries, metric series, and the ability to be primary. `AI_PROVIDER_ORDER=GEMINI,OPENAI`
restores the exact pre-change routing.

## 4. Database migration — additive, verified non-destructive

`prisma/migrations/20260810120000_ai_provider_anthropic/migration.sql`:

```sql
ALTER TYPE "AiProviderType" ADD VALUE IF NOT EXISTS 'ANTHROPIC';
```

| Check | Before | After |
| --- | --- | --- |
| Enum labels | `GEMINI, OPENAI` | `GEMINI, OPENAI, ANTHROPIC, GROQ` |
| `ai_gateway_requests` rows by provider | `OPENAI=1625`, `(null)=85` | `OPENAI=1625`, `(null)=85` |
| Prisma client enum | `GEMINI, OPENAI` | `GEMINI, OPENAI, ANTHROPIC, GROQ` |

`prisma db push` was **not** used (recorded incident: it previously dropped columns in this
repo). Existing label ordinals are unchanged, so no historical row was rewritten.

## 5. Structural certification — 48 / 48

Each scenario runs in its own process with the environment fixed at spawn, because provider
config is evaluated once at module load. Upstream traffic goes to a locally spawned mock
server or to an unroutable address (`127.0.0.1:1`). Keys used are obvious fakes passed in
memory; nothing was written to disk.

| Area | Result |
| --- | --- |
| Enum contains ANTHROPIC; GEMINI + OPENAI retained | T01–T02 PASS |
| Default order `ANTHROPIC,GEMINI,OPENAI`; model + API version pinned | T03–T05 PASS |
| Presence detection without exposure | T06, T08 PASS |
| `AI_PROVIDER_ORDER` override / unknown names dropped / duplicates collapsed | T07, T09, T10 PASS |
| Adapter: provider identity, multi-block concat, token mapping, latency | T11–T14 PASS |
| Dry-run served locally and labelled, no egress | T15 PASS |
| Claude serves as primary, `fallbackUsed=false`, no spurious retry | T16–T18 PASS |
| Claude down → OpenAI answers, `fallbackUsed=true`, transition metric | T19–T20, T23 PASS |
| **Attempt budget: primary 2, fallback 1** | T21, T22, T25 PASS |
| Total outage fails closed; no key, no auth header in message or stack | T24, T26–T27 PASS |
| Nothing configured → `no_provider_available`, zero upstream attempts | T28–T29 PASS |
| OpenAI can still be primary; Claude not attempted when it succeeds | T30–T31 PASS |
| Circuit breaker covers ANTHROPIC and opens past threshold | T32–T33 PASS |
| Cost uses Anthropic's own pricing | T34 PASS |
| Health: four providers, names primary, no key, ok/degraded/down correct | T35–T40 PASS |
| Groq adapter identity and OpenAI-compatible usage mapping | T41–T42 PASS |
| **Exhausted provider hands off to Groq automatically**, bounded, metric recorded | T43–T47 PASS |
| Groq cost uses its own pricing | T48 PASS |

### Attempt-budget evidence (metric deltas, not source reading)

```
Claude unreachable, OpenAI mock reachable:
  homigo_ai_provider_usage{provider="ANTHROPIC",status="failure"}  +2   (1 call + 1 retry)
  homigo_ai_provider_usage{provider="OPENAI",status="success"}     +1   (1 attempt)
  homigo_ai_fallback_total{from="ANTHROPIC",to="OPENAI"}           +1

Both unreachable:
  ANTHROPIC failure +2 · OPENAI failure +1 · fallback +1 · then normalized error
```

Bounded exactly as the two-provider design was. No retry storm.

## 6. Live provider certification — **PASS (Gemini)**

Real calls, real content, real tokens, real cost. Nothing mocked.

| Scenario | Result |
| --- | --- |
| Gemini live as primary | `provider=GEMINI` · `content="HOMIGO-LIVE-OK"` · in=20 out=6 · cost $0.0000033 · 2,186 ms |
| **Live failover** — Claude configured but unreachable | `provider=GEMINI` · `fallbackUsed=true` · real content · 2,427 ms |
| Customer E2E through the running gateway | `mode=llm`, HTTP 200, no fixture content |

Failover metric evidence from the same process, before → after:

```
homigo_ai_provider_usage{provider="ANTHROPIC",status="failure"}  2   (1 call + 1 retry)
homigo_ai_provider_usage{provider="GEMINI",status="success"}     1   (1 attempt, live)
homigo_ai_fallback_total{from="ANTHROPIC",to="GEMINI"}           1
```

This closes the gate the previous certification could not: **a customer request traversed
gateway → router → failed primary → live fallback → real model answer.**

### 6a. Two real defects found by enabling a credential

**D1 — the Gemini key was never used.** `callGemini` always went to Vertex
(`aiplatform.googleapis.com`) via application-default credentials and read
`GEMINI_API_KEY` only for the presence check. A valid key therefore made
`isGeminiConfigured()` true while every call failed `PERMISSION_DENIED`, burning two router
attempts on a provider that could not work. Fixed: the adapter now selects the Gemini
Developer API when a key is present and keeps the Vertex/ADC path otherwise.
*Related:* the configured default `gemini-2.0-flash` does not exist on the Developer API —
model ids are not portable between the two transports.

**D2 — an empty completion was returned as an answer.** Reasoning models spend output
budget on thinking and can return HTTP 200 with zero text parts
(`finishReason: MAX_TOKENS`). Measured: ~118 thinking tokens before visible text, while
shipped templates budget as little as 512. All three adapters now raise on a blank
completion so the router fails over instead of delivering an empty string. Health probes
were raised from 8 to 256 output tokens for the same reason.

## 7. Live Claude call — **NOT VERIFIED**

No credential exists, so no real generation was performed and none was fabricated.

**What *is* proven against the real `api.anthropic.com` endpoint**: one probe with a
deliberately fake key returned

```
Anthropic 401: {"type":"error","error":{"type":"authentication_error",
                "message":"invalid x-api-key"}, "request_id":"req_011Cdtmk…"}
```

The API accepted the URL, the `anthropic-version` header, and the request body, and
rejected **only the credential** — not the shape. That removes request-format risk from the
remaining unknown. It does **not** prove a successful generation, token accounting, or
real-world latency, and is not claimed to.

| Gate | Result |
| --- | --- |
| Claude live success | **NOT VERIFIED** — no credential |
| Claude token usage / cost from real billing | **NOT VERIFIED** |
| Claude → Gemini live fallback | **NOT VERIFIED** — structurally proven only |
| Gemini live / OpenAI live | **NOT VERIFIED** — unchanged from prior certification |

## 8. Regression suites — no regressions

| Suite | Result |
| --- | --- |
| Anthropic structural (`anth_assert.ts`) | **40 pass / 0 fail** |
| Structural regressions (`phase3_bypass.ts`) | **12 pass / 0 fail** |
| Gateway assertions (`phase3_assert.ts`) | **23 pass / 0 fail** |
| Runtime certification (`phase3_runtime.ts`, live server) | **27 pass / 0 fail / 0 not verified** |
| Phase 2 ETA regression (`eta-assert.ts`) | **30 pass / 0 fail** |
| Backend typecheck | **83 errors — byte-identical to the pre-change baseline; 0 in any edited file** |

`phase3_bypass.ts` needed two assertions retargeted, both because the contract they encoded
changed on purpose — "exactly two providers" became "exactly three, with Gemini and OpenAI
required to survive", and the hardcoded two-provider degraded-mode guard became the
provider-agnostic one. Both were **tightened**, not relaxed: the new version additionally
asserts Claude is registered in the router map and that the router reads the configured
order.

## 9. Live runtime evidence

`GET /api/ai/health` on a running backend with no credentials:

```json
{"status":"down","gateway":true,"primary":"ANTHROPIC",
 "providerOrder":["ANTHROPIC","GEMINI","OPENAI"],
 "anthropic":{"configured":false,"circuit":"closed"},
 "gemini":{"configured":false,"circuit":"closed"},
 "openai":{"configured":false,"circuit":"closed"}}
```

Presence booleans only. `/metrics` carries the three-provider series pre-seeded at zero,
including all six ordered fallback pairs.

## 10. Security — PASS

| Check | Result |
| --- | --- |
| Anthropic-key-shaped literal in tracked source | **0** |
| `ANTHROPIC_API_KEY` assigned to a literal anywhere | **0** |
| Key in any log/console call in AI code | **0** |
| Anthropic referenced in any client app (5 roots) | **0** |
| Key in error message or stack under failure | **0** (T26) |
| Auth header in error message or stack | **0** (T27) |
| Key exposed via `/api/ai/health` | **0** (T37) |
| Key written to any file by the test harness | **0** — fakes passed in process memory only |

Pre-existing, unrelated: `sk-test…` strings are deliberate injection-test fixtures, and a
Google Maps browser key appears in `apps/web/.env.example` and `homigo-mobile/app.json`.
Neither was introduced here; the Maps key is client-side by design but is worth a rotation
review separately.

## 11. Production safety — NONE TOUCHED

| Check | Result |
| --- | --- |
| Production database / secrets / Cloud Run / env vars | not accessed, not modified |
| Migration applied to | local dev `homigo_db` only |
| ETA ML inference | **OFF** — unchanged |
| Google Maps customer-facing ETA | **UNCHANGED** |
| ETA models trained or promoted | **none** |
| 50K synthetic dataset | untouched; no production insertion |
| `git add -A` / reset / restore / clean / stash / push | **never run** |

## 12. Operational limits observed on the live keys

The credential works, but its project is on the free tier:

```
quotaId:    GenerateRequestsPerDayPerProjectPerModel-FreeTier
quotaValue: 20            (requests per day, per model)
model:      gemini-3.6-flash   (what gemini-flash-latest resolves to)
```

Consequences measured, not assumed:

- Sequential low-volume calls succeed (3 live successes recorded).
- A 60-request concurrency burst exhausted the daily allowance; every subsequent call
  returned `429 RESOURCE_EXHAUSTED`, and it did **not** recover after 150 s of waiting —
  it is a per-day, not per-minute, limit.
- During the burst the gateway behaved correctly: 39 × 429 from our own rate limiter,
  21 × 502 `PROVIDER_ERROR` from the exhausted upstream. No fabricated content, no crash.
- Quota is per model, so switching `AI_GEMINI_MODEL` to another available id grants a
  separate 20/day allowance. That is a workaround, not a fix.

**This key cannot carry real traffic.** Enable billing on the project, or treat Gemini as a
low-volume tier only.

### Groq — measured from live response headers

```
x-ratelimit-limit-requests: 1000        (per day)
x-ratelimit-limit-tokens:   12000       (per minute — the binding constraint)
```

- 20 concurrent requests at 128 output tokens: **20/20 succeeded**.
- 30 concurrent at 1024 output tokens: 9 succeeded, 21 × 429 — 30 × 1024 reserved tokens
  exceeds the 12k/min budget. The limit is tokens-per-minute, not concurrency.
- Latency ~250 ms, roughly an order of magnitude faster than Gemini on this account.

Groq has ~50× Gemini's daily request headroom, so in the configured order it is the tier
that actually carries traffic once Gemini's 20/day is spent.

## 12b. Live quota hand-off — **PASS**

The headline behaviour, proven on a real exhausted quota rather than a simulated one.
Gemini's free-tier daily allowance was genuinely spent at the time of this run.

```
chain:      ANTHROPIC -> GEMINI -> GROQ -> OPENAI
configured: ANTHROPIC=false  GEMINI=true  GROQ=true  OPENAI=false

ANSWERED BY: GROQ | model: llama-3.3-70b-versatile | fallbackUsed: true
content: "HOMIGO-LIVE-OK" | tokens 55/8 | cost $0.00003877 | 1,829 ms

homigo_ai_provider_usage{provider="GEMINI",status="failure"}  2   (1 call + 1 retry)
homigo_ai_provider_usage{provider="GROQ",status="success"}    1   (1 attempt, live)
homigo_ai_fallback_total{from="GEMINI",to="GROQ"}             1
```

Unconfigured Anthropic was skipped without consuming budget; exhausted Gemini consumed
exactly its bounded 2 attempts; Groq answered on its first. No human intervention, no
config change at request time.

Under the 60-request runtime burst the same mechanism produced **11 real HTTP 200 answers**
where the previous run produced none — traffic Gemini alone could not have served.

### Cost of keeping an exhausted provider in the chain — measured

Eight sequential requests with Gemini out of quota and Groq healthy:

| Request | Answered by | Gemini attempts | Gemini circuit | Latency |
| --- | --- | --- | --- | --- |
| 1 | GROQ | 2 | closed | 1,726 ms |
| 2 | GROQ | 2 | closed | 1,035 ms |
| 3 | GROQ | 1 | **open** | 846 ms |
| 4–8 | GROQ | **0** | open | **105–214 ms** |

The circuit breaker absorbs the problem after three requests: once five failures accumulate
Gemini is skipped entirely, Groq becomes the effective primary, and latency drops to
~110 ms. The residual cost is one probe attempt per 60 s reset window, not a per-request tax.

Reordering is therefore optional rather than necessary. It remains a one-line environment
change if you want to eliminate even the probe:

```bash
AI_PROVIDER_ORDER=ANTHROPIC,GROQ,GEMINI,OPENAI
```

### Direction is not fixed — the chain is generic

The hand-off logic is one provider-agnostic loop, verified in both directions:
Gemini → Groq live (above), and Groq → OpenAI against a mock
(`chain: GROQ -> OPENAI`, Groq unreachable, `answered by: OPENAI`, `fallbackUsed: true`).

What the design does **not** do is rotate or load-balance. Every request starts at the top
of the chain; a later provider is reached only because an earlier one failed or was skipped.
That is deliberate (ADR-020 §1) — deterministic routing keeps cost, latency and audit
attribution predictable.

## 13. Credential hygiene incident

The Gemini key **and** the Groq key were pasted into the assistant conversation. Both are
therefore recorded in the chat transcript and must be treated as compromised: **rotate
both** — Gemini via Google Cloud Console → APIs & Services → Credentials (restrict the
replacement to the Generative Language API), Groq via console.groq.com → API Keys.

Both keys were written only to `apps/backend/.env.local`, which is git-ignored
(`apps/backend/.gitignore:10`). It is not in any tracked file, any log, any test output, or
any document — re-verified by repo-wide scan after the change.

## 14. Known behaviour changes

1. **`fallbackUsed` semantics.** It now means "an earlier provider was attempted and
   failed", not "the answer came from the second-listed provider". A single-provider
   deployment that previously reported `fallbackUsed=true` now reports `false`. Dashboards
   reading this field will shift.
2. **Cost per request rises materially** if Claude is enabled — roughly 20× Gemini in the
   metering table. Watch `homigo_ai_daily_cost_usd` after enabling.
3. **Worst-case failure latency grows with chain length** — 4 bounded attempts across three
   providers before the deterministic fallback answers.
4. **`getAiHealth()` response gained fields** (`primary`, `providerOrder`, `anthropic`).
   Both existing consumers spread the object, so this is additive and safe.

## 15. To complete this certification

Add the key where the app reads configuration — never to a tracked file, never into chat:

```bash
# apps/backend/.env.local   (git-ignored — confirmed)
ANTHROPIC_API_KEY=<the key>
```

Then restart the backend and re-run, in order:

```
bun run <scratchpad>/anth_assert.ts        # expect 40/40 (unchanged)
bun run <scratchpad>/phase3_runtime.ts     # the NOT VERIFIED line should become a live PASS
```

A live pass additionally requires: a real generation with non-fixture content, non-zero
token counts sourced from `usage`, a computed cost > 0, and — for the fallback gate — a
second configured provider with Claude deliberately misconfigured.

Verdict moves to **A** only when those produce real results. Until then this remains **B**.
