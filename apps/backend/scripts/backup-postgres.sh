#!/usr/bin/env bash
# Hourly HOMIGO backup wrapper — delegates to cross-platform backup-db.ts
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun --env-file=.env run scripts/backup-db.ts
