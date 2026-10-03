# PHASE 14 — Privacy Matrix

Built from the actual Prisma schema and the running platform's emitted telemetry — not from a
generic PII checklist. Every "no exposure" claim below was checked against 690 live metric series
and the source that produces them.

**This is a technical inventory. It is not a legal classification**, and nothing here asserts DPDP
compliance — see the note at the end.

---

## A. Classification taxonomy

This project has no canonical privacy taxonomy in code. Rather than invent one and imply legal
weight it does not carry, the classification below is **technical**, and derived from how each
field is already treated by `lib/privacy-policy.engine.ts` and `lib/prisma-pii-extension.ts`:

| Class | Meaning here |
|---|---|
| `PUBLIC` | Already visible to any authenticated user by design |
| `INTERNAL` | Operational, not about an identifiable person |
| `PERSONAL` | Identifies a person |
| `SENSITIVE` | Personal **and** encrypted at rest, or precise-location |
| `HIGH_RISK` | Identity documents and financial identifiers |

---

## B. Inventory

| Data type | Location (schema) | Class | Purpose | AI exposure | Log exposure | Metric exposure | Retention | Access | Deletion |
|---|---|---|---|---|---|---|---|---|---|
| Name | `User.firstName/lastName` | PERSONAL | fulfilment, support | Via bound context only | Not logged | **None** | Business record | Owner, assigned partner (active job), admin | `DeletionRequest` |
| Email | `User.email` | PERSONAL | auth, notification | No | Redacted | **None** | Business record | Owner, admin | `DeletionRequest` |
| Phone | `User.phone` | PERSONAL | fulfilment | **Masked** for partners (`maskPhoneForPartner`) | Not logged | **None** | Business record | Owner, admin; partner sees masked | `DeletionRequest` |
| Address | `Address.*` | **SENSITIVE** | fulfilment | Partner-safe projection only, and only while the booking is in an active fulfilment status | Not logged | **None** | Business record | `assertBookingAudience` | `DeletionRequest` |
| Precise GPS | `Tracking`, `LocationHistory` | **SENSITIVE** | live tracking, safety | No | Not logged | **None** (`lat`/`lng` never a label) | Business record | Booking parties, ops safety | Cascade |
| Identity documents | `ProviderDocument`, `PartnerBackgroundCheck` | **HIGH_RISK** | KYC | No | No | **None** | Business record | Admin `USERS/APPROVE` | Retained — KYC evidence |
| Financial identifiers | `SavedPaymentMethod`, `Withdrawal` | **HIGH_RISK** | payment | No | Redacted | **None** | `PAYMENT_EVENTS` 8y / `FINANCIAL_LEDGER` 10y | Owner, finance admin | Retained — statutory-shaped |
| Device identifiers | `UserDevice`, audit `device_id` | PERSONAL | security | No | Security events only | **None** | `SECURITY_EVENTS` 7y | Admin | Cascade |
| Support conversations | `SupportTicketMessage` | PERSONAL | support | **Yes** — RAG/support context | Not logged | **None** | Business record | Ticket parties, support | `DeletionRequest` |
| Customer↔partner messages | `BookingMessage` | PERSONAL | fulfilment | No | Not logged | **None** | Business record | Booking parties | Cascade |
| AI prompts | `AiGatewayRequest.promptHash` | INTERNAL | audit | Hash only | **Hash only, never text** | **None** | **`AI_TELEMETRY` — no duration agreed** | Admin | — |
| AI conversation text | `AiMessage.content` | PERSONAL | assistant memory | Yes — it is the conversation | Not logged | **None** | Business record | Owner | Cascade |
| Encryption keys | `EncryptionKey` | **HIGH_RISK** | crypto | No | **Never** | **None** | Key lifecycle | System | Rotation only |
| Consent | `ConsentRecord` | PERSONAL | compliance | No | No | **None** | Compliance record | Owner, admin | Retained as evidence |

---

## C. Exposure controls, verified

### Metrics — **VERIFIED CLEAN**

Scraped from the running backend and parsed label keys **and values**:

| Check | Result |
|---|---|
| Series carrying labels | **690** |
| Distinct label keys | **48** |
| Forbidden keys (`user_id`, `customer_id`, `booking_id`, `email`, `phone`, `prompt`, `token`, `address`, `lat`, `lng`, `ip`, `device_id`, …) | **NONE** |
| Values matching an email pattern | **NONE** |
| Values matching a phone pattern | **NONE** |
| Values matching cuid/uuid (an id leaking under an innocent key) | **NONE** |
| Values matching a credential prefix (`eyJ`, `sk-`, `rzp_`, `AIza`, `ghp_`) | **NONE** |

Checking **values** as well as keys matters: a label named `subject` carrying a cuid would pass a
key-only audit and still publish a user identifier to anyone who can read `/metrics`.

### AI prompts — hash, never text

`AiGatewayRequest` and `AiGatewayAudit` store `promptHash` / `responseHash`. A blocked prompt now
also carries a hash on the non-ai-brain path (fixed in an earlier phase). No table stores prompt
text for audit purposes.

### Logs

Provider failover logs record provider, outcome, taxonomy code and timing — **content never
appears**. Tool bridge failures log `toolId`, code and `actorRole`, never arguments.

### Purpose limitation — real, and narrow

`lib/privacy-policy.engine.ts` carries an explicit `PrivacyPurpose` of
`booking_fulfilment | booking_history | directory | safety_ops`, and address disclosure to a
partner requires **both** `purpose === "booking_fulfilment"` **and** a booking status in
`ACCEPTED / ASSIGNED / EN_ROUTE / IN_PROGRESS`. A partner who finished the job yesterday cannot
read the address today.

This is genuine purpose limitation, but it is **scoped to booking PII**. It is not a
platform-wide purpose register, and this phase did not extend it into one — doing so would have
meant assigning purposes to every table by guesswork.

---

## D. Retention by data class

| Class | Category | Days | Source |
|---|---|---|---|
| Security events | `SECURITY_EVENTS` | 2,555 (7y) | Pre-existing |
| Payment events | `PAYMENT_EVENTS` | 2,920 (8y) | Pre-existing |
| Financial ledger | `FINANCIAL_LEDGER` | 3,650 (10y) | Pre-existing |
| Login events | `LOGIN_EVENTS` | 730 (2y) | Pre-existing |
| System logs | `SYSTEM_LOGS` | 365 (1y) | Pre-existing |
| **AI telemetry** | `AI_TELEMETRY` | **undecided** | **Phase 14 — mechanism only** |
| **Automation telemetry** | `AUTOMATION_TELEMETRY` | **undecided** | **Phase 14 — mechanism only** |
| **Operational activity** | `OPERATIONAL_ACTIVITY` | **undecided** | **Phase 14 — mechanism only** |

**The five pre-existing durations are inherited, not endorsed.** They were already in the codebase
as `DEFAULT_RETENTION` constants when this phase began. This phase did not re-derive or validate
them against any legal requirement, and they should not be read as legally reviewed.

**The three new ones are deliberately blank.** They sweep as `NO_POLICY` and delete nothing.
Choosing "90 days" to make the feature look complete would silently decide how far back an incident
stays investigable — on tables holding the policy-decision history of an AI system.

---

## E. Deletion and erasure

| Mechanism | Location | Behaviour |
|---|---|---|
| Deletion request | `DeletionRequest` | Tracked, admin-actioned |
| Data export | `DataExportRequest` | Tracked, admin-actioned |
| Compliance request | `ComplianceRequest` + `ComplianceRequestAudit` | Approve/reject behind `DISPUTES/APPROVE` |
| Cascade | Prisma `onDelete: Cascade` | Child records follow the parent |
| Retention lock | Financial and KYC tables | Retained under their own categories |

**Not resolved here, and not invented.** Whether a deletion request should erase financial and KYC
evidence is a legal question. This phase neither deleted audit evidence to satisfy a request nor
invented an exemption to justify keeping it. **`LEGAL_DECISION_REQUIRED`.**

---

## F. DPDP standing

What exists: consent recorded **against a policy version** rather than a boolean; access control;
purpose limitation on booking PII; export and deletion request tracking; processing traceability
through the audit log; field-level encryption for sensitive columns; retention infrastructure.

What does not: any legal interpretation. There is no document in this repository stating which DPDP
obligations apply, which lawful basis each processing purpose relies on, or what retention the law
requires. **These are DPDP-oriented technical controls. This phase does not assert compliance**,
and building the controls does not produce it.
