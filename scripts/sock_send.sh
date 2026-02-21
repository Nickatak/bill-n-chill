#!/usr/bin/env bash
set -euo pipefail

SOCKFILE="${1:-sockfile}"
LOGFILE="${2:-TANDEM_LOG.md}"
LINE="${3:-}"

if [ -z "$LINE" ]; then
  echo "usage: scripts/sock_send.sh <sockfile> <logfile> '<json-line>'" >&2
  exit 1
fi

extract_field() {
  local line="$1"
  local key="$2"
  printf '%s' "$line" | sed -n "s/.*\"$key\":\"\([^\"]*\)\".*/\1/p"
}

safe_val() {
  local v="$1"
  local fallback="$2"
  if [ -z "$v" ]; then
    printf '%s' "$fallback"
  else
    printf '%s' "$v"
  fi
}

format_local_ts() {
  local raw_ts="$1"
  if [ -n "$raw_ts" ] && date -u -d "$raw_ts" +"%m/%d %H:%M" >/dev/null 2>&1; then
    TZ=America/Los_Angeles date -d "$raw_ts" +"%m/%d %H:%M"
  else
    TZ=America/Los_Angeles date +"%m/%d %H:%M"
  fi
}

if [ ! -f "$SOCKFILE" ]; then
  touch "$SOCKFILE"
fi

if [ ! -f "$LOGFILE" ]; then
  cat > "$LOGFILE" <<'LOGEOF'
# TANDEM_LOG

Human-readable mirror of messages written to `sockfile`.

Format:
- one message per Markdown list item:
  - `[MM/DD HH:MM] DIR=<TX|RX> FROM=<from> TO=<to> TYPE=<type> TASK=<task_id> MSG=<msg>`

---
LOGEOF
fi

printf '%s\n' "$LINE" >> "$SOCKFILE"

ts_raw=$(safe_val "$(extract_field "$LINE" "ts")" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")
ts=$(format_local_ts "$ts_raw")
from=$(safe_val "$(extract_field "$LINE" "from")" "unknown")
to=$(safe_val "$(extract_field "$LINE" "to")" "broadcast")
typ=$(safe_val "$(extract_field "$LINE" "type")" "unknown")
task_id=$(safe_val "$(extract_field "$LINE" "task_id")" "-")
msg=$(safe_val "$(extract_field "$LINE" "msg")" "")

tmp=$(mktemp)
divider_line=$(awk '/^---$/{print NR; exit}' "$LOGFILE")

if [ -n "$divider_line" ]; then
  {
    head -n "$divider_line" "$LOGFILE"
    printf -- '- [%s] DIR=TX FROM=%s TO=%s TYPE=%s TASK=%s MSG=%s\n' "$ts" "$from" "$to" "$typ" "$task_id" "$msg"
    tail -n "+$((divider_line + 1))" "$LOGFILE"
  } > "$tmp"
else
  {
    printf -- '- [%s] DIR=TX FROM=%s TO=%s TYPE=%s TASK=%s MSG=%s\n' "$ts" "$from" "$to" "$typ" "$task_id" "$msg"
    cat "$LOGFILE"
  } > "$tmp"
fi
mv "$tmp" "$LOGFILE"
