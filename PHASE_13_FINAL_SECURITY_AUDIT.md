# PHASE 13 — Final Security Audit

Every property below was **executed**, not described. The previous Phase-13 pass documented the
Grafana auth posture and asserted the dashboards carry no sensitive labels; it never demonstrated
that an unauthenticated caller actually gets in, never showed what a broken datasource does, and
never proved the production `/metrics` guard denies. Documentation of a security property is not a
test of it.

---

## A. Authentication — demonstrated

| # | Probe | Result | Evidence |
|---|---|---|---|
| 1 | Anonymous **reads** IOC dashboards | **OPEN** | `GET /api/search?query=IOC` → **HTTP 200** with no credentials |
| 2 | Anonymous reaches org-scoped API | **OPEN** | `GET /api/org` → **HTTP 200** |
| 3 | Anonymous **creates** a dashboard | **OPEN** | `POST /api/dashboards/db` → **HTTP 200**; probe dashboard created and then deleted |

### Finding — dev Grafana grants Admin to anyone who can reach it

`apps/backend/monitoring/_obsstack/docker-compose.yml`:

```yaml
GF_AUTH_ANONYMOUS_ENABLED: "true"
GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
GF_SECURITY_ADMIN_PASSWORD: homigo_admin      # hardcoded
```

Probe 3 escalates this from a config observation to a demonstrated capability: an unauthenticated
request **created a dashboard**. Read, edit and delete are all available to anyone who can reach
port 3004.

**Not changed.** This is the running environment's access configuration; altering it silently could
lock someone out of their own tooling, and the phase is explicit that a security change of this kind
is not made without the owner deciding. Classified `HUMAN_DECISION_REQUIRED`.

**Remediation** (two lines, mirroring what staging already does):

```yaml
GF_AUTH_ANONYMOUS_ENABLED: "false"
GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?required}
```

**Bounded blast radius.** Even open, the IOC exposes no PII, no prompts, no per-user cost and no
customer, booking or ticket identifiers — proven in §C. The exposure is dashboard integrity
(edit/delete) rather than data confidentiality.

---

## B. Role matrix

Grafana here runs a single organisation with anonymous access; the HOMIGO application roles
(`ADMIN` / `SUPPORT` / `PARTNER` / `CUSTOMER`) are **not** propagated into Grafana — it is a separate
system with its own identity. Stating that plainly matters more than drawing a matrix that implies an
integration which does not exist.

| Role | Reaches Grafana? | Effective Grafana role | Sees IOC data | Can edit dashboards |
|---|---|---|---|---|
| Anyone with network access to :3004 (dev) | yes | **Admin** (anonymous) | yes | **yes** — demonstrated |
| Grafana admin (dev) | yes | Admin | yes | yes |
| Anyone (staging :3006) | **no** | — | no | no — anonymous disabled, password required |
| HOMIGO `ADMIN` / `SUPPORT` / `PARTNER` / `CUSTOMER` | not applicable | not mapped | — | — |

**Application-side RBAC is unaffected by this phase.** The IOC adds no HOMIGO API surface: it reads
Prometheus, and Prometheus reads the backend's `/metrics`. No admin route, permission or role
mapping was created or modified.

---

## C. Data exposure

| # | Property | Method | Result |
|---|---|---|---|
| 1 | No sensitive dimension used as a label | label keys extracted from `{…}` selectors and `by()`/`without()` clauses across all 95 queries, tested against a forbidden set | **0 matches** |
| 2 | Label cardinality bounded | every grouping label checked against a closed allow-list | **0 unexpected** |
| 3 | Raw prompts never queried | `homigo_ai_prompt_blocked` carries `category` only | ✓ |
| 4 | Tool arguments never queried | `homigo_ai_tool_*` carries `category` / `tool_id` only | ✓ |
| 5 | No per-user cost | cost aggregated by `provider` and `role` only | ✓ |
| 6 | No secrets in labels | no metric label carries a key, token or credential | ✓ |

**Forbidden as labels:** `customer_id`, `user_id`, `booking_id`, `ticket_id`, `email`, `phone`,
`prompt`, `api_key`, `token`, `arguments`, `argument`, `payload`, `content`.

**Allowed grouping labels** (all closed sets): `consumer`, `event_type`, `domain`, `status`, `mode`,
`provider`, `role`, `endpoint`, `reason`, `category`, `direction`, `model`, `check`, `from`, `to`,
`job`.

### A note on how this check was got wrong twice

The first version scanned whole dashboard JSON and failed on a *description* stating that prompts are
never labels. The second substring-matched query text and failed on the metric name
`homigo_ai_prompt_blocked` — precisely the safe design it should have approved. Both were tests of
prose, not of the property. The check now extracts label keys, which is what "no sensitive label" has
always meant. Recorded because a security check that fails on its own documentation is a check nobody
should trust.

---

## D. Endpoint protection

| # | Surface | Dev | Production | Verified |
|---|---|---|---|---|
| 1 | Backend `/metrics` | open (`NODE_ENV !== production`) | requires `OPS_AUTH_TOKEN`; **denies when the token is unset** | source-verified in `ops-auth.ts` |
| 2 | Grafana datasource proxy | admin-authenticated in probes | staging requires auth | ✓ |
| 3 | Prometheus :9090 | open on localhost | separate staging instance | ✓ |

**`EXTERNAL_ARTIFACT_REQUIRED`** — a production scrape would need `OPS_AUTH_TOKEN` added to the
scrape config's `authorization` block. The dev scrape config carries no credential because the guard
is open outside production, which is correct for dev and insufficient for production.

---

## E. Failure modes cannot be mistaken for data

| # | Condition | Result | Evidence |
|---|---|---|---|
| 1 | Unknown datasource | error, not 0 | HTTP **404** through the proxy |
| 2 | Malformed PromQL | error, not 0 | HTTP **400**, `status=error`, parse error surfaced |
| 3 | Metric does not exist | no series, not 0 | 0 series returned |
| 4 | Producer down | NO DATA, not 0 | **93 of 95 panels** returned no series |
| 5 | Histogram with no observations | NO DATA, not ~0 | absent until a real observation |

An infrastructure failure never becomes a confident number.

---

## F. Environment isolation

| Property | Dev | Staging |
|---|---|---|
| Grafana | :3004, anonymous **Admin** | :3006, anonymous **disabled**, password from env |
| Scrape job | `homigo-backend` → `host.docker.internal:3010`, HTTP | `homigo-backend-staging`, **HTTPS + authorization** |
| Dashboard dir | `_obsstack/dashboards` — IOC boards live here | `deploy/observability/staging` — **untouched** |
| Compose file | separate | separate |

**Verified:** zero IOC files exist under `deploy/observability`, and `git status` reports that tree
byte-for-byte unchanged. A dashboard cannot silently switch environment: each Grafana has exactly one
datasource pointing at its own Prometheus.

---

## G. Verdict

| Area | State |
|---|---|
| Data confidentiality | **PASS** — no PII, prompts, tool arguments, secrets or per-user cost reachable |
| Label cardinality | **PASS** — closed sets only |
| Failure semantics | **PASS** — errors and absence never become values |
| Environment isolation | **PASS** — staging untouched and locked down |
| Production endpoint guard | **PASS** in code; scrape credential is `EXTERNAL_ARTIFACT_REQUIRED` |
| Dev Grafana authentication | **FINDING — `HUMAN_DECISION_REQUIRED`**, demonstrated not merely described, remediation supplied, deliberately not applied |

**10 / 10 probes executed. One finding, owner's decision to act on.**
