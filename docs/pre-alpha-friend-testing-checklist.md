# Pre-Alpha Friend Testing Checklist

## Goal

Run a controlled pre-alpha test with trusted friends, gather high-signal feedback, and avoid production-level expectations.

## 1) Go / No-Go Gate

- [ ] `frontend` lint passes: `npm run lint --prefix frontend`
- [ ] `frontend` build passes: `npm run build --prefix frontend`
- [ ] backend smoke check passes: `GET /api/v1/health/` returns `status=ok`
- [ ] demo reset path works end-to-end: `reset_fresh_demo` completes successfully
- [ ] one full money-loop walkthrough can be completed without DB manual edits

## 2) Deployment Metadata Setup

- [ ] set backend env `APP_REVISION` to deployed commit SHA (or release tag)
- [ ] ensure backend can write reset marker (default: `backend/.runtime/last_data_reset_at.txt`)
- [ ] optional: set `DATA_RESET_MARKER_PATH` if filesystem layout differs

## 3) Data Reset Workflow

- [ ] run:

```bash
backend/.venv/bin/python backend/manage.py reset_fresh_demo
```

- [ ] confirm `/api/v1/health/` includes `data_reset_at`
- [ ] confirm login/register warning panel shows:
  - Last data reset
  - Deployed commit

## 4) Tester Access Setup

- [ ] share test URL and short disclaimer:
  - pre-alpha
  - data may reset
  - no sensitive/real financial data
- [ ] provide one recommended scenario script (10-15 minutes)
- [ ] provide one fallback login path (`/register` + `/`)

## 5) Suggested Friend Test Script

1. Create account (`/register`)
2. Sign in (`/`)
3. Quick add a lead (`/intake/quick-add`)
4. Convert lead to project
5. Open project + financial summary
6. Create estimate and move lifecycle status
7. Create invoice or vendor bill
8. Record payment and allocation

## 6) Feedback Capture Format

Ask each tester for:

- one confusing moment
- one broken/buggy behavior
- one missing “expected” behavior
- one thing that felt surprisingly clear

## 7) Safety / Scope Rules

- [ ] no real customer PII
- [ ] no real bank/accounting credentials
- [ ] no promises on data persistence between sessions
- [ ] collect screenshots + route + timestamp for bug reports

## 8) Post-Session Triage

- [ ] classify findings:
  - blocker
  - high-friction
  - polish
- [ ] patch blockers first
- [ ] rerun reset + smoke before next friend cohort
