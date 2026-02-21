#!/usr/bin/env bash
set -euo pipefail

SOCKFILE="${1:-sockfile}"
LOGFILE="${2:-TANDEM_LOG.md}"
FROM="codex-a"

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

now_ts() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

format_local_ts() {
  local raw_ts="$1"
  if [ -n "$raw_ts" ] && date -u -d "$raw_ts" +"%m/%d %H:%M" >/dev/null 2>&1; then
    TZ=America/Los_Angeles date -d "$raw_ts" +"%m/%d %H:%M"
  else
    TZ=America/Los_Angeles date +"%m/%d %H:%M"
  fi
}

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

log_json_human() {
  local line="$1"
  local direction="${2:-TX}"
  local ts_raw ts from to typ task_id msg

  ts_raw=$(safe_val "$(extract_field "$line" "ts")" "$(now_ts)")
  ts=$(format_local_ts "$ts_raw")
  from=$(safe_val "$(extract_field "$line" "from")" "unknown")
  to=$(safe_val "$(extract_field "$line" "to")" "broadcast")
  typ=$(safe_val "$(extract_field "$line" "type")" "unknown")
  task_id=$(safe_val "$(extract_field "$line" "task_id")" "-")
  msg=$(safe_val "$(extract_field "$line" "msg")" "")

  local tmp divider_line
  tmp=$(mktemp)
  divider_line=$(awk '/^---$/{print NR; exit}' "$LOGFILE")

  if [ -n "$divider_line" ]; then
    {
      head -n "$divider_line" "$LOGFILE"
      printf -- '- [%s] DIR=%s FROM=%s TO=%s TYPE=%s TASK=%s MSG=%s\n' "$ts" "$direction" "$from" "$to" "$typ" "$task_id" "$msg"
      tail -n "+$((divider_line + 1))" "$LOGFILE"
    } > "$tmp"
  else
    {
      printf -- '- [%s] DIR=%s FROM=%s TO=%s TYPE=%s TASK=%s MSG=%s\n' "$ts" "$direction" "$from" "$to" "$typ" "$task_id" "$msg"
      cat "$LOGFILE"
    } > "$tmp"
  fi
  mv "$tmp" "$LOGFILE"
}

append_json() {
  local line="$1"
  printf '%s\n' "$line" >> "$SOCKFILE"
  log_json_human "$line"
}

safe_task_id() {
  local t="$1"
  if [ -z "$t" ]; then
    printf '%s' "unknown"
  else
    printf '%s' "$t"
  fi
}

LAST=$(wc -l < "$SOCKFILE")
append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"type\":\"status\",\"task_id\":\"coord-001\",\"msg\":\"auto_poller_online\"}"

while true; do
  CUR=$(wc -l < "$SOCKFILE")
  if [ "$CUR" -gt "$LAST" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue

      if printf '%s' "$line" | grep -q '"from":"'$FROM'"'; then
        continue
      fi

      if ! printf '%s' "$line" | grep -q '"from":"codex-b"'; then
        continue
      fi

      # Mirror inbound messages from codex-b for full timeline visibility.
      log_json_human "$line" "RX"

      typ=$(extract_field "$line" "type")
      task_id=$(safe_task_id "$(extract_field "$line" "task_id")")

      append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"type\":\"status\",\"task_id\":\"$task_id\",\"msg\":\"seen\",\"seen_type\":\"$typ\"}"

      case "$typ" in
        handshake)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"type\":\"handshake_ack\",\"msg\":\"ack_from_auto_poller\"}"
          ;;
        task_claim)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"type\":\"status\",\"task_id\":\"$task_id\",\"msg\":\"ack_task_claim\"}"
          ;;
        echo_test_request)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"to\":\"codex-b\",\"type\":\"echo_test_response\",\"task_id\":\"$task_id\",\"msg\":\"ECHO_OK_FROM_CODEX_A\"}"
          ;;
        ping)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"to\":\"codex-b\",\"type\":\"pong\",\"task_id\":\"$task_id\",\"msg\":\"pong\"}"
          ;;
        question)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"to\":\"codex-b\",\"type\":\"status\",\"task_id\":\"$task_id\",\"msg\":\"question_received_needs_model_turn\"}"
          ;;
      esac
    done < <(sed -n "$((LAST + 1)),$CUR p" "$SOCKFILE")

    LAST="$CUR"
  fi

  sleep 1
done
