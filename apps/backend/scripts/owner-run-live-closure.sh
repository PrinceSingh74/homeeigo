#!/usr/bin/env bash
# Owner-run live closure for homigo_db — steps A, C, D, E, E2, F (and G as a second command).
#
#   cd /d/homigo/apps/backend
#   bash scripts/owner-run-live-closure.sh          # A, C, D, E, E2, F   (backend must be STOPPED)
#   bash scripts/owner-run-live-closure.sh g        # G strict flag       (backend must be RUNNING)
#
# Run it yourself in Git Bash. It asks "yes" before every write, runs the read-only verifier after
# every step and stops at the first step that does not verify. Step B (the four stale bookings)
# is NOT here on purpose: it moves money and needs your Razorpay dashboard lookup — see
# scripts/owner-live-closure-runbook.md, section B.
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ACTOR="cmq9h67pk0000tz8s6tvnpet5"
DB_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
FLAG_ENV="$(grep '^APP_ENV=' .env | cut -d= -f2-)"
BASELINE="backups/capability-pool-baseline-homigo_db-$(date -u +%Y-%m-%d).json"
# A new approval file per run: an approval is provenance and is never overwritten (the emitter refuses).
APPROVAL="backups/phase10-approval-$(date -u +%Y-%m-%dT%H-%M-%SZ).json"
LOG="backups/owner-live-closure-$(date -u +%Y-%m-%dT%H-%M-%SZ).log"

say()  { printf '\n==== %s\n' "$*" | tee -a "$LOG"; }
die()  { printf '\nSTOPPED: %s\nNothing further was run. Log: %s\n' "$*" "$LOG" | tee -a "$LOG"; exit 1; }
ask()  { printf '\n%s\nType yes to continue: ' "$*"; read -r a; [ "$a" = "yes" ] || die "you did not type yes"; }
run()  { printf '\n$ %s\n' "$*" | sed -E 's#postgresql://[^ ]+#<db url>#g' | tee -a "$LOG"; "$@" 2>&1 | sed -E 's#postgresql://[^ ]+#<db url>#g' | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }
port_up() { (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

VERIFY_OUT=""
verify() { # verify [extra args]; fills VERIFY_OUT, never stops by itself
  VERIFY_OUT="$(bun run scripts/live-closure-verify.ts --url "$DB_URL" "$@" 2>&1 | sed -E 's#postgresql://[^ ]+#<db url>#g')"
  printf '%s\n' "$VERIFY_OUT" | grep -E '^(PASS|PENDING|FAIL|BLOCKED) ' | tee -a "$LOG"
}
need_pass() { printf '%s\n' "$VERIFY_OUT" | grep -qE "^PASS +$1" || die "verifier does not show PASS for \"$1\""; }

case "$DB_URL" in */homigo_db|*/homigo_db\?*) ;; *) die "DATABASE_URL in .env is not homigo_db" ;; esac
DB_NAME="homigo_db"
# Rehearsal on a restored copy: CLOSURE_REHEARSAL_DB=homigo_rehearsal_test_XXXX bash scripts/owner-run-live-closure.sh
if [ -n "${CLOSURE_REHEARSAL_DB:-}" ]; then
  case "$CLOSURE_REHEARSAL_DB" in *rehearsal_test*) ;; *) die "CLOSURE_REHEARSAL_DB must contain rehearsal_test" ;; esac
  DB_NAME="$CLOSURE_REHEARSAL_DB"
  DB_URL="${DB_URL%/homigo_db*}/$DB_NAME"
  BASELINE="backups/capability-pool-baseline-$DB_NAME.json"
  APPROVAL="backups/phase10-approval-$DB_NAME-$(date -u +%Y-%m-%dT%H-%M-%SZ).json"
  echo "REHEARSAL on $DB_NAME — homigo_db is not touched"
fi
# The Prisma CLI reads DATABASE_URL; pin it to the database this script checked.
export DATABASE_URL="$DB_URL"
mkdir -p backups

if [ "${1:-}" = "g" ]; then
  say "STEP G — strict service capability (flag environment: $FLAG_ENV)"
  port_up 3000 || die "the backend is not running on :3000 — start it first (bun run dev)"
  [ -f "$BASELINE" ] || BASELINE="$(ls -t backups/capability-pool-baseline-homigo_db-*.json 2>/dev/null | head -1)"
  [ -n "$BASELINE" ] && [ -f "$BASELINE" ] || die "no capability baseline file in backups/ — run steps A–F first"
  verify --baseline "$BASELINE"
  need_pass "F capability backfill"
  if ! printf '%s\n' "$VERIFY_OUT" | grep -qE '^PASS +G strict dry run'; then
    printf '\nThe strict DRY RUN is not PASS (usually: no partner online, so there is nothing to compare).\n'
    printf 'Step F already proved the pool is identical for every service and provider.\n'
    ask "Enable strict anyway?"
  fi
  ask "Enable matching.strict_service_capability for environment \"$FLAG_ENV\" through the admin route?"
  PW="$(grep -oE 'DEMO_PASSWORD = "[^"]+"' scripts/ensure-demo-users.ts | cut -d'"' -f2)"
  TOKEN="$(curl -s -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"admin@homigo.demo\",\"password\":\"$PW\",\"setAuthCookies\":false}" | bun run scripts/json-get.ts data.accessToken)"
  [ -n "$TOKEN" ] || die "admin login returned no token"
  curl -s -X PATCH http://127.0.0.1:3000/api/admin/platform/flags -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"key\":\"matching.strict_service_capability\",\"enabled\":true,\"rolloutPct\":100,\"environment\":\"$FLAG_ENV\",\"description\":\"Phase 11 strict typed capability gate\",\"reason\":\"live closure step G\"}" | tee -a "$LOG"
  echo
  verify --baseline "$BASELINE"
  need_pass "G strict flag"
  say "G done. If \"G runtime strict parity\" above is FAIL, switch the flag off again (same command with enabled:false) and send the log: $LOG"
  exit 0
fi

say "PRE-FLIGHT"
port_up 3000 && die "a backend is running on :3000 — stop it before the migration (it hot-reloads and holds connections)"
run bunx prisma migrate status
say "BACKUP"
DUMP="backups/${DB_NAME}_pre-closure_$(date -u +%Y-%m-%dT%H-%M-%SZ).dump"
MSYS_NO_PATHCONV=1 docker exec homigo-postgres pg_dump -U postgres -Fc "$DB_NAME" > "$DUMP" || die "backup failed"
N="$(MSYS_NO_PATHCONV=1 docker exec -i homigo-postgres pg_restore --list < "$DUMP" | grep -c 'TABLE DATA')"
[ "$N" -ge 200 ] || die "backup lists only $N tables"
sha256sum "$DUMP" > "$DUMP.sha256"
echo "backup: $DUMP ($N tables)" | tee -a "$LOG"

say "STEP A — migrations"
verify
if printf '%s\n' "$VERIFY_OUT" | grep -qE '^PASS +A migrations'; then echo "already applied — skipping" | tee -a "$LOG"; else
  ask "Apply the pending migrations to $DB_NAME? (additive only; backup taken above)"
  run bunx prisma migrate deploy || die "migrate deploy failed"
  verify
fi
need_pass "A migrations"
need_pass "A schema objects"

say "STEP C — 25 service contents"
if printf '%s\n' "$VERIFY_OUT" | grep -qE '^PASS +C content'; then echo "already applied — skipping" | tee -a "$LOG"; else
  run bun run scripts/phase10-content-validate.ts >/dev/null || die "content validator reported violations"
  printf '\nYour name, as the owner approving this content: '; read -r OWNER
  [ -n "$OWNER" ] || die "an approver name is required"
  # The emitter refuses placeholders ("YOUR NAME", "<your name>", "$OWNER", …) with exit 2.
  run bun run scripts/phase10-emit-approval.ts --approved-by "$OWNER" --out "$APPROVAL" || die "could not write the approval file"
  run bun run scripts/phase10-content-apply-plan.ts --url "$DB_URL" --summary
  ask "Apply the execution / safety / quality content to the 25 services listed as 'would apply'?"
  run bun run scripts/phase10-content-apply-plan.ts --url "$DB_URL" --summary --apply --allow-live \
    --approved-by "$OWNER" --owner-approval "$APPROVAL" --actor-id "$ACTOR" || die "content apply failed"
  verify
fi
need_pass "C content"
# Who approved it: a real name at apply time, or an owner attestation (phase10-attest-approval.ts).
need_pass "C approval provenance"

step() { # step <gate label> <title> <script> <question>
  say "STEP $2"
  if printf '%s\n' "$VERIFY_OUT" | grep -qE "^PASS +$1"; then echo "already applied — skipping" | tee -a "$LOG"; return; fi
  run bun run "scripts/$3" --url "$DB_URL"
  ask "$4"
  run bun run "scripts/$3" --url "$DB_URL" --apply --actor-id "$ACTOR" --allow-live || die "$3 failed"
  verify
  need_pass "$1"
}
step "D held services"   "D — six held services (safety + quality + non-method steps; WORK steps withheld)" phase10-apply-held-safety.ts "Apply to the six held services?"
step "E age policy"      "E — age policy (no age restriction where the catalogue states none)"              phase10-apply-age-policy.ts "Apply the age policy?"
step "E2 dispute policy" "E2 — published 48-hour dispute window + free rework first"                        phase10-apply-published-dispute-policy.ts "Apply the dispute policy? (Say no if 48 hours / free rework is NOT what you want enforced)"

say "STEP F — capability backfill"
verify --baseline "$BASELINE" >/dev/null 2>&1 || true
if [ -f "$BASELINE" ] && printf '%s\n' "$VERIFY_OUT" | grep -qE '^PASS +F capability backfill'; then echo "already applied — skipping" | tee -a "$LOG"; else
  run bun run scripts/phase11-capability-backfill.ts --url "$DB_URL" --write-baseline "$BASELINE" || die "backfill report failed"
  grep -q "EXACT" "$LOG" || die "the backfill report does not say parity EXACT"
  ask "Insert the capability rows listed above as 'rows to insert'? (rolled back automatically if any provider pool changes)"
  run bun run scripts/phase11-capability-backfill.ts --url "$DB_URL" --apply --actor-id "$ACTOR" --allow-live || die "backfill failed (nothing was written)"
  verify --baseline "$BASELINE"
fi
need_pass "F capability backfill"

say "A, C, D, E, E2, F are done and verified."
cat <<EOF | tee -a "$LOG"

Next:
  1. Start your backend again:            bun run dev
  2. Then enable strict matching:          bash scripts/owner-run-live-closure.sh g
  3. Four stale bookings (moves money):    scripts/owner-live-closure-runbook.md, section B
  4. Still BLOCKED until you decide:       spa, personal-hygiene-bathing-care (no content exists)

Log of this run: $LOG
EOF
