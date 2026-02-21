#!/usr/bin/env bash
set -euo pipefail

SOCKFILE="${1:-sockfile}"
FROM="codex-b"
PEER="codex-a"

if [ ! -f "$SOCKFILE" ]; then
  touch "$SOCKFILE"
fi

append_json() {
  printf '%s\n' "$1" >> "$SOCKFILE"
}

now_ts() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

extract_field() {
  local line="$1"
  local key="$2"
  printf '%s' "$line" | sed -n "s/.*\"$key\":\"\([^\"]*\)\".*/\1/p"
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

      if ! printf '%s' "$line" | grep -q '"from":"'$PEER'"'; then
        continue
      fi

      typ=$(extract_field "$line" "type")
      task_id=$(safe_task_id "$(extract_field "$line" "task_id")")
      to=$(extract_field "$line" "to")

      if [ -n "$to" ] && [ "$to" != "$FROM" ]; then
        continue
      fi

      # Avoid cross-poller ack loops on status chatter.
      if [ "$typ" = "status" ]; then
        continue
      fi

      append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"type\":\"status\",\"task_id\":\"$task_id\",\"msg\":\"seen\",\"seen_type\":\"$typ\"}"

      case "$typ" in
        handshake)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"to\":\"$PEER\",\"type\":\"handshake_ack\",\"msg\":\"ack_from_auto_poller\"}"
          ;;
        ping)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"to\":\"$PEER\",\"type\":\"pong\",\"task_id\":\"$task_id\",\"msg\":\"pong\"}"
          ;;
        echo_test_request)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"to\":\"$PEER\",\"type\":\"echo_test_response\",\"task_id\":\"$task_id\",\"msg\":\"ECHO_OK_FROM_CODEX_B\"}"
          ;;
        question)
          append_json "{\"ts\":\"$(now_ts)\",\"from\":\"$FROM\",\"to\":\"$PEER\",\"type\":\"status\",\"task_id\":\"$task_id\",\"msg\":\"question_received_needs_model_turn\"}"
          ;;
      esac
    done < <(sed -n "$((LAST + 1)),$CUR p" "$SOCKFILE")

    LAST="$CUR"
  fi

  sleep 1
done
