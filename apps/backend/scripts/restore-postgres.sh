#!/usr/bin/env bash
# HOMIGO PostgreSQL restore wrapper — requires RESTORE_CONFIRM=yes
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${RESTORE_CONFIRM:-}" != "yes" ]]; then
  echo "Set RESTORE_CONFIRM=yes to acknowledge destructive restore." >&2
  exit 1
fi
exec bun --env-file=.env run scripts/restore-postgres.ts "$@"
