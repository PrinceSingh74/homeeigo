#!/usr/bin/env bash
# Apply enterprise GFS backup retention (7 daily / 4 weekly / 12 monthly).
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun --env-file=.env run scripts/apply-backup-retention.ts "$@"
