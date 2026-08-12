# PII Compliance Report — Phase 1

**Date:** 2026-06-10  
**Standards:** DPDP Act 2023, GDPR Art. 5/32  
**Evidence:** Execution only

---

## Before / After

| Field | Before | After | Evidence |
|-------|--------|-------|----------|
| `users.email` plaintext | 170 / 171 (99.4%) | **0 / 171 (0%)** | `verify-pii-encryption.ts` |
| `users.phone_number` plaintext | 170 / 171 | **0 / 171** | same |
| `users` ENCRYPTED status | 1 | **171** | same |
| Provider PAN/Aadhaar/bank plaintext | unknown | **0 sensitive plaintext fields** | same |
| OTP `phone_number` plaintext | present | **0** | same |

---

## Migration Steps Executed

| Step | Command | Result |
|------|---------|--------|
| 1. Bootstrap encryption keys | `bun run migrate:pii` (includes key bootstrap) | ✅ |
| 2. Backfill 170 users | `bun run migrate:pii` | ✅ migrated=170 |
| 3. Encrypt provider KYC/bank | `bun run scripts/migrate-provider-sensitive.ts` | ✅ 6 providers |
| 4. Verify integrity | `bun run verify:pii` | ✅ pass=true |
| 5. Sample decrypt + hash check | 50 users, 0 mismatches | ✅ |
| 6. Address encryption backfill | `bun run migrate:address` | ✅ migrated=56, 0 remaining |

```json
{
  "users": { "plaintextEmail": 0, "plaintextPhone": 0, "encrypted": 171, "pass": true },
  "providers": { "plaintextSensitiveFields": 0 }
}
```

---

## Encryption Architecture (verified in code)

| Component | Implementation |
|-----------|----------------|
| Algorithm | AES-256-GCM (`pii-crypto.ts`, `encryption.service.ts`) |
| IV | 12 bytes, unique per record |
| Auth tag | 16 bytes, packed with ciphertext |
| Lookup | HMAC-SHA256 blind index (`email_hash`, `phone_hash`) |
| Key rotation | `EncryptionKey` table, ACTIVE/ROTATED/RETIRED |
| Audit | `EnterpriseAuditLog` with tamper hash |
| New user writes | Plaintext null, encrypted only (`user-pii.service.ts`) |
| Provider KYC | In-field encryption `enc:v1:` + hash columns (`sensitive-data.service.ts`) |

---

## Remaining Gaps (honest)

| Gap | Risk | Recommendation |
|-----|------|----------------|
| ~~`addresses.*` plaintext~~ | ✅ | **56 addresses encrypted**, 0 pending backfill |
| `gift_cards.recipient_email/phone` plaintext | MEDIUM | Encrypt on create |
| `users.kyc_document_number` may be plaintext legacy | HIGH | Run KYC backfill script |
| `MASTER_ENCRYPTION_KEY` not set in dev `.env` | CRITICAL in prod | Set before production deploy |
| Addresses in backups | LOW | Encrypted at rest; rotate backups after deploy |

---

## DPDP / GDPR Checklist

| Requirement | Status |
|-------------|--------|
| Encryption at rest (email/phone) | ✅ |
| Purpose limitation (audit logs) | ✅ |
| Data minimization (plaintext cleared) | ✅ Users |
| Right to erasure path | ✅ `DeletionRequest` model exists |
| Breach detection (audit trail) | ✅ `EnterpriseAuditLog` |
| Key management | ✅ with rotation support |
| Address encryption | ✅ 56/56 ENCRYPTED |
| KYC full coverage | ⚠️ legacy `kyc_document_number` may remain |

---

## Rollback Procedure

1. Restore DB from `bun run backup:db` snapshot taken before migration
2. Re-deploy previous backend build (reads plaintext fallback still in `userPiiService.resolveEmail`)
3. Plaintext columns were nulled — **rollback requires backup**, not code-only

---

## Reproduction

```bash
cd apps/backend
bun run migrate:pii
bun run migrate:provider-sensitive
bun run verify:pii
```

**Phase 1 user/provider PII: PASS** (with address gap documented)
