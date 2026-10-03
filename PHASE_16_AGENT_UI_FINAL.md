# PHASE 16 — AGENT CONTROL CENTER UI (FINAL)

## What was built

| Route | Purpose | Bundle |
|---|---|---|
| `/agents` | Fleet command center | 7.29 kB |
| `/agents/[agentId]` | One agent's workspace | 5.44 kB |
| `/agents/runs/[runId]` | Run timeline with authoritative tool rows | 7.64 kB |

Built on the existing HOMIGO design system — `PageShell`, `biz-glass-panel`, `--color-biz-*`
tokens. No new design language, no second component library.

## The ten operational states are computed, not decorated

§30 asks for ten distinguishable states. Inventing them in the client would have produced a
convincing screen backed by nothing, so `agents/observability/agent-health.ts` derives each from a
real signal — a flag row, a readiness probe, an in-flight run count, a measured failure ratio — and
returns it with the reason that produced it.

| State | Derived from |
|---|---|
| `OFF` | `AGENTS_ENABLED` is not true |
| `BLOCKED` | kill switch engaged, **or** tool registry incomplete |
| `WAITING_APPROVAL` | agent-run steps in `AWAITING_APPROVAL` |
| `SHADOW` | environment not permitted, **or** flag off |
| `ERROR` | ≥90% of recent runs failed |
| `DEGRADED` | ≥30% of recent runs failed |
| `RUNNING` | non-terminal runs in flight |
| `CONTROLLED` | flag enabled at `rolloutPct < 100` |
| `LIVE` | fully enabled, has measured runs |
| `READY` | fully enabled, no runs in window |

**Ordering is the design.** Several conditions can hold at once, and `resolveState` returns the one
that most changes what an operator does next. `BLOCKED` outranks `CONTROLLED` because a kill switch
makes the rollout percentage irrelevant. `WAITING_APPROVAL` outranks `RUNNING` because a human is
the bottleneck. `DEGRADED` outranks `READY` because an agent that is technically available and
failing a third of its runs is not ready for anything.

## The three §66 rules, enforced in one place

`lib/agent-states.ts` is the single vocabulary. Every screen imports from it, so two surfaces cannot
disagree about what a state means.

**UNKNOWN is never healthy.** `DEPENDENCY_STATE.UNKNOWN` is neutral-toned, never green, and its hint
says *"the probe could not determine a result. This is not the same as healthy."* The audit-trail
probe returns `UNKNOWN` when it sees zero governance rows in 24h, because it genuinely cannot tell a
quiet system from a broken writer.

**WAITING_APPROVAL is never a failure.** Amber, not red, and labelled *"Waiting on human"* with the
hint *"the designed outcome for high-risk actions"*. Colouring it red would train operators to treat
correct governance as an incident.

**BLOCKED is never OFF.** `OFF` is neutral; `BLOCKED` is critical. "Someone turned this off" and
"this cannot run" need completely different responses, and collapsing them hides the second one.

## Insufficient data is not zero

The server returns `null` for a success rate it declines to compute — fewer than five runs, because
one failure out of one run is not "0% success" in any useful sense. `formatRate` is the only
function that decides how `null` renders, so no screen can accidentally turn it into `0%`.

The same applies to the fleet spend total: it sums **only** across agents the server actually
measured, and reports `—` when none were. Treating `null` as `0` would have made "we have no data"
look identical to "we spent nothing".

## Blocking conditions render above the metrics

A kill switch or an unseeded registry makes every number below it misleading, so those banners are
the first thing on the page — with `role="alert"` — before the fleet summary. The readiness banner
states the actual consequence: *"every tool call fails at the audit write, before the handler."*

## What the UI deliberately cannot do

**No "go live" control.** Execution is decided by the environment allowlist and the feature flag on
the server. A toggle that appeared to override either would be a rollout bypass dressed as
convenience. The card explains state; it does not grant it.

**No approval buttons.** Approvals are decided through the existing `/ai-brain/approvals` surface,
which already carries non-self-approval and single-consume. A second approval door means two rule
sets to keep in step, and the quieter one eventually wins. The agent workspace links to it rather
than reimplementing it.

**No chain-of-thought.** The run timeline is assembled from persisted step rows — capability, risk,
policy decision, execution id, verification verdict, redacted arguments. Raw model reasoning is
never stored and never shown; §66 asks for structured rationale, and a model's narration of its own
run is a claim about it rather than a record of it.

**The manual run button is shadow-only.** An exploratory run an operator kicks off should never be
the path by which a side effect happens.

## Accessibility and responsiveness

`role="alert"` on blocking banners · `aria-pressed` on filter toggles · `role="group"` with
`aria-label` on the filter set · `<caption class="sr-only">` on every table · `scope="col"` on
headers · `aria-hidden` on decorative icons · visible `focus-visible:ring` on every interactive
element · `title` carrying the server's reason on every state badge.

Mobile is a **different layout**, not a shrunk table (§38): the run list renders as cards below
`md`, because a nine-column table on a phone is unusable. The agent grid reflows 1 → 2 → 3 columns.

## Verification

- Admin panel build: **exit 0**, all three routes emitted
- TypeScript: **0 errors**
- Every rendered state value originates from `getAgentHealth()` or `getDependencyHealth()` — no
  client-side invention
- Dependency probes are measured (DB round-trip, registry resolution, outbox counts, scheduler
  registration, audit volume, provider error ratio) and each can return `UNKNOWN`
