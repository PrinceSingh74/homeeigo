# Evidence — S3 Backup Validation

Generated: 2026-06-09T05:00:12.430Z
Verdict: **PARTIAL** — bucket=homigo-prod-backups-prince region=eu-north-1 recoverable=true

## Backup Integrity / Checksum / Storage Risk
| Check | Status | Detail |
|---|:--:|---|
| backup_creation | PASS ✅ | 2 dump object(s); newest=homigo_2026-06-09T05-00-05-859Z.dump |
| bucket_default_encryption | PASS ✅ | AES256 |
| versioning | PASS ✅ | Status=Enabled |
| lifecycle_rules | PASS ✅ | 1 rule(s): homigo-backups-retention |
| cross_region_replication | FAIL ❌ | The replication configuration was not found |
| object_encryption | PASS ✅ | SSE=AES256 |
| restore_capability | PASS ✅ | downloaded 3106484 bytes; pg custom-format magic=PGDMP ✅ |
| checksum_validation | PASS ✅ | sha256=9fb1c8943b8610d6… size=3106484 match=true s3Checksum={"ChecksumCRC32":"xNCccg==","ChecksumType":"FULL_OBJECT"} |

## 100% Recoverability Statement
- Proven: newest dump downloaded, PGDMP magic verified, checksum/size matched → **recoverable ✅**
