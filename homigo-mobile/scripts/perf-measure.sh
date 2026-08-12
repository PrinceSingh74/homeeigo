#!/usr/bin/env bash
# Repeatable performance probe for the Homeeigo customer app on a USB-connected
# Android device. Written as a script rather than ad-hoc adb calls so a baseline
# and a follow-up run are captured the same way and can be diffed.
#
#   usage: scripts/perf-measure.sh <label> [metro-log-path]
#
# Emits a single block of key=value lines to stdout, prefixed with the label, so
# runs can be appended to a file and compared.
#
# Notes on probe reliability, learned on a Realme RMX3943 (Android 15):
#   * `dumpsys gfxinfo` intermittently answers "Failure while dumping the app"
#     when the process is busy. The script retries and reports UNAVAILABLE rather
#     than silently emitting nothing.
#   * `BufferQueueProducer` fps lines only appear while frames are actually being
#     queued, so they are useless when idle and are not used here.
set -uo pipefail

ADB="${ADB:-/d/Android/Sdk/platform-tools/adb.exe}"
PKG="${PKG:-com.homigo.mobile}"
LABEL="${1:-run}"
METRO_LOG="${2:-}"

pid() { "$ADB" shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}'; }

emit() { printf '%s.%s=%s\n' "$LABEL" "$1" "$2"; }

PID="$(pid)"
if [ -z "$PID" ]; then
  echo "ERROR: $PKG is not running" >&2
  exit 1
fi
emit pid "$PID"

# ---- memory (PSS is the number that matters for pressure on Android) ----
MEM="$("$ADB" shell dumpsys meminfo "$PKG" 2>/dev/null | tr -d '\r')"
emit mem_total_pss_kb "$(echo "$MEM" | grep -m1 'TOTAL PSS:' | awk '{print $3}')"
emit mem_total_rss_kb "$(echo "$MEM" | grep -m1 'TOTAL RSS:'  | awk '{print $6}')"
emit mem_native_heap_kb "$(echo "$MEM" | grep -m1 'Native Heap' | awk '{print $3}')"
emit mem_dalvik_heap_kb "$(echo "$MEM" | grep -m1 'Dalvik Heap' | awk '{print $3}')"
emit views "$(echo "$MEM" | grep -m1 'Views:' | awk '{print $2}')"

# ---- cpu ----
emit cpu_pct "$("$ADB" shell top -n 1 -b -p "$PID" 2>/dev/null | tr -d '\r' | tail -1 | awk '{print $9}')"

# ---- frames / jank ----
GFX="$("$ADB" shell dumpsys gfxinfo "$PKG" 2>/dev/null | tr -d '\r')"
if echo "$GFX" | grep -q 'Total frames rendered'; then
  emit frames_total  "$(echo "$GFX" | grep -m1 'Total frames rendered' | awk '{print $4}')"
  emit frames_janky  "$(echo "$GFX" | grep -m1 'Janky frames:'         | awk '{print $3}')"
  emit frames_janky_pct "$(echo "$GFX" | grep -m1 'Janky frames:'      | tr -d '()%' | awk '{print $4}')"
  emit frame_p50_ms  "$(echo "$GFX" | grep -m1 '50th percentile'       | awk '{print $3}' | tr -d 'ms')"
  emit frame_p90_ms  "$(echo "$GFX" | grep -m1 '90th percentile'       | awk '{print $3}' | tr -d 'ms')"
  emit frame_p95_ms  "$(echo "$GFX" | grep -m1 '95th percentile'       | awk '{print $3}' | tr -d 'ms')"
  emit frame_p99_ms  "$(echo "$GFX" | grep -m1 '99th percentile'       | awk '{print $3}' | tr -d 'ms')"
else
  emit frames_total UNAVAILABLE
fi

# ---- request volume, if a Metro log was supplied ----
if [ -n "$METRO_LOG" ] && [ -f "$METRO_LOG" ]; then
  TOTAL=$(grep -coE '(GET|POST) http://[^ ]*/api/' "$METRO_LOG" || true)
  emit api_requests_total "${TOTAL:-0}"
  BOOKINGS=$(grep -coE 'GET http://[^ ]*/api/users/bookings' "$METRO_LOG" || true)
  emit api_users_bookings "${BOOKINGS:-0}"
  TRACK=$(grep -coE 'GET http://[^ ]*/api/tracking/' "$METRO_LOG" || true)
  emit api_tracking "${TRACK:-0}"
  TRACK404=$(grep -oE 'GET http://[^ ]*/api/tracking/[^ ]* → 404' "$METRO_LOG" | wc -l || true)
  emit api_tracking_404 "${TRACK404:-0}"
fi

# ---- reset frame stats so the next run measures a fresh window ----
"$ADB" shell dumpsys gfxinfo "$PKG" reset >/dev/null 2>&1 || true
