# Tandem Codex Protocol

This directory documents the two-agent setup used in this repo (`codex-a` + `codex-b`) with `sockfile` coordination.

## Topology

- Primary agent: `codex-a` (talks to user directly in chat).
- Secondary agent: `codex-b` (works in parallel and coordinates through `sockfile`).
- Shared transport: repo file `sockfile` at `/home/nick/bill_n_chill/sockfile`.
- Transport format: append-only JSONL (one JSON object per line).

## Core Rule Set

1. `codex-a` is the primary user-facing agent.
2. Both agents coordinate work claims/status/results through `sockfile`.
3. Every outbound `sockfile` message must also be written to `TANDEM_LOG.md` in human-readable form.
   - one message per line:
     `[MM/DD HH:MM] DIR=<TX|RX> FROM=<from> TO=<to> TYPE=<type> TASK=<task_id> MSG=<msg>`
   - timestamp is Pacific local time (`America/Los_Angeles`).
   - newest messages are inserted at the top of the file (reverse-chronological order).
4. If either agent needs user direction, both agents pause feature work.
5. Human input requests must be written to:
   - `/home/nick/ASSISTANCE_NEEDED.MD`
6. Work resumes only after user clarification.

## Message Types

Supported shared message types:

- `handshake`
- `handshake_ack`
- `task_claim`
- `status`
- `result`
- `question`
- `answer`
- `ping`
- `pong`
- `protocol`
- `echo_test_request`
- `echo_test_response`

Required fields (recommended):

- `ts`: UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`)
- `from`: sender (`codex-a` or `codex-b`)
- `type`: message type
- `task_id`: include for all task-related lines
- `msg`: short payload text
- optional `to`: explicit recipient

## Poller Behavior

Current automation script:

- `scripts/sock_poller.sh`
- `scripts/sock_send.sh`

Behavior:

- Watches appended lines in `sockfile`.
- Ignores own messages.
- Auto-acks seen `codex-b` messages with a `status` line.
- Auto-responds to common control messages (`handshake`, `task_claim`, `ping`, `echo_test_request`).
- For freeform `question` lines, emits status indicating a model turn may be needed.
- Every message written by the poller is also logged to `TANDEM_LOG.md`.

`scripts/sock_send.sh` usage:

- Use for manual message sends so writes are mirrored into both files.
- Command shape:

```bash
scripts/sock_send.sh sockfile TANDEM_LOG.md '{"ts":"...","from":"codex-a","type":"status","task_id":"x","msg":"..."}'
```

## Boot Procedure (Repeatable)

From repo root:

```bash
# 1) Ensure channel file exists
: > sockfile

# 2) Start codex-a poller
scripts/sock_poller.sh sockfile

# 3) Start codex-b poller (symmetrical setup in other agent session)
# (run equivalent command in codex-b terminal)
```

Then exchange a handshake:

```json
{"ts":"...","from":"codex-a","type":"handshake","msg":"ready_for_tandem","protocol":"jsonl_append_only"}
{"ts":"...","from":"codex-b","type":"handshake_ack","msg":"acknowledged_ready_for_tandem","protocol":"jsonl_append_only"}
```

## Work Coordination Pattern

1. Claim first:
   - writer posts `task_claim` with `task_id`, owner, scope.
2. Update progress:
   - post `status` messages keyed by same `task_id`.
3. Publish completion:
   - post `result` with files/tests/outcome.
4. Primary summary:
   - `codex-a` reports consolidated outcome to user in chat.

## Human-Input Escalation Pattern

When blocked on direction/opinion/decision:

1. Stop both agents on feature execution.
2. Update `/home/nick/ASSISTANCE_NEEDED.MD` with:
   - decision needed
   - why blocked
   - options considered
   - recommended option
   - exact response needed
   - UTC timestamp
3. Post protocol/status lines in `sockfile` indicating pause.
4. Wait for user response.

## Known Constraint

- Agents can auto-respond in `sockfile` continuously.
- Agent cannot proactively send a new chat turn to user without user input; therefore, `codex-a` surfaces important updates on the next user turn.

## Current Branch/State Note

- Branch used when protocol was formalized: `danger`.
- Escalation file path is outside repo by design: `/home/nick/ASSISTANCE_NEEDED.MD`.
