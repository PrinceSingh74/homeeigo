# HOMIGO P4 — Security Review Report

**Date:** 2026-06-09  
**Scope:** Encryption, key management, audit retention, compliance APIs  
**Status:** Production-ready (Parts A–C)

## Cryptography

| Control | Implementation |
|---------|----------------|
| Algorithm | AES-256-GCM with 12-byte IV and 16-byte auth tag |
| Key hierarchy | Master key wraps per-purpose DEKs in `encryption_keys` |
| Lookup indexes | HMAC-SHA256 blind indexes (`email_hash`, `phone_hash`) |
| Key rotation | `KeyManagementService.rotateKey()` — ACTIVE → ROTATED, decrypt-only |

## Access Control

- PII decrypt requires explicit `userPiiService.resolve*` with `authorized: true`
- Admin provider lists return masked email/phone
- Compliance admin endpoints require `AdminUser` profile
- JWT + refresh token cleanup on scheduled retention jobs

## Audit & Immutability

- Dual-write: `ActivityLog` (legacy) + `EnterpriseAuditLog` (immutable)
- Integrity hash per enterprise audit row (`sha256(action:actor:resource:traceId:status)`)
- PII redacted from audit before/after payloads
- gzip archival before hard delete past `retentionExpiresAt`

## OWASP Alignment

- **A02 Cryptographic Failures:** Mitigated via AES-256-GCM + no plaintext PII at rest
- **A01 Broken Access Control:** Admin RBAC + authorized decrypt paths
- **A09 Logging Failures:** Enterprise audit with retention categories

## Residual Risks

1. Legacy `activity_logs` table still receives security events (migration path to enterprise-only)
2. OTP table retains `phone_hash` only for new records; legacy rows may have plaintext until backfill
3. Local export storage used when `AWS_S3_BUCKET` unset — restrict filesystem permissions in production

## Key Rotation Procedure

1. `keyManagementService.rotateKey("EMAIL")` (and PHONE/PII as needed)
2. Run `scripts/migrate-user-pii-encryption.ts` to re-encrypt with new DEK version
3. Retire old key after all ciphertext references updated: `retireKey(purpose, oldVersion)`
