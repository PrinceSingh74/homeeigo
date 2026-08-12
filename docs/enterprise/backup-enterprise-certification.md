# HOMIGO Enterprise Backup Retention Certification

**Generated:** 2026-07-02T11:14:30.855Z  
**Method:** runtime audit of `./backups` — no assumptions.

## Audit summary

| Metric | Value |
|--------|-------|
| Total dumps (before) | 1 |
| Total size (before) | 21.72 MB |
| Valid backups | 1 |
| Corrupt / invalid | 0 |
| Unverified (pg_restore unavailable) | 0 |
| Retention policy | 7 daily / 4 weekly / 12 monthly |
| Kept after retention | 1 |
| Deleted (expired) | 0 |
| Total size (after) | 21.72 MB |

## Integrity verification

| File | Size | SHA256 OK | Archive OK | Verified | Tier |
|------|------|-----------|------------|----------|------|
| homigo_2026-07-02T11-12-24-611Z.dump | 21.72 MB | ✅ | ✅ | ✅ | monthly |

## Retention tier distribution

- **newest:** 0
- **monthly:** 1
- **weekly:** 0
- **daily:** 0

## Safety rules

- Newest valid backup protected: **homigo_2026-07-02T11-12-24-611Z.dump**
- Monthly snapshots never deleted: **enforced** (1 monthly tier)

## Prometheus metrics

| Metric | Value |
|--------|-------|
| backup_total | 1 |
| backup_size_bytes | 22774385 |
| backup_last_success_timestamp | 1782990756 |
| backup_retention_deleted_total | 0 |

## Manifest

- `backup-manifest.json` → backups\backup-manifest.json

## Verdict

**PASS** — Enterprise GFS retention active; integrity verified; newest backup protected.

## Commands

```bash
cd apps/backend
bun run backup:db                          # create + retain
bun run backup:retention                   # apply retention only
bun run backup:verify-restore              # scratch DB restore drill
bun run cert:backup                        # re-run this certification
```