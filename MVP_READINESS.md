# MVP Readiness Audit — 2026-03-24

## Verdict: Ship-ready with a short punch list

Core product is solid. Auth, money handling, org scoping, and the estimate->CO->invoice->payment pipeline are well-tested and correctly implemented. 474 backend tests + 165 frontend tests with real behavioral assertions. No placeholder pages, no dead links, no security holes found.

---

## Tier 1 — Fix before launch

- [x] **Add `tsc --noEmit` to CI** — TypeScript errors can slip to prod undetected. ESLint catches some, not all. ~30 min.
- [x] **Receipt scan returns 200 on Gemini failure** — `backend/core/views/accounts_payable/receipt_scan.py:104-110` — frontend can't distinguish "scan found nothing" from "API is down." Should return 502/503 on exception, 200 only on successful-but-empty extraction.
- [x] **Docker resource limits in prod** — No `deploy.resources.limits` on any container. On a 16GB VPS, one runaway process can OOM everything.

## Tier 2 — Should do soon, not blocking

- [ ] **Create `restore-db.sh`** — Backup script is solid but no documented restore procedure. Untested backups aren't backups.
- [x] **Add Python linting to CI + pre-commit** — No ruff/flake8 configured anywhere. Frontend has ESLint; backend has nothing.
- [ ] **15 untested endpoints** — Push (3), impersonate (3), org management (7), stores (1), receipt scan (1). All functional, just no test coverage. Org management is the most important gap — invite flows, role changes, logo upload.
- [x] **Pre-commit hook only runs frontend lint** — Backend changes get zero local validation before commit. Extend to include Python lint + `tsc --noEmit`.

## Tier 3 — Track, don't block

- [ ] No route-level `error.tsx` boundaries — Global fallback works; feature-specific would be better UX.
- [ ] No coverage reporting in CI — `.coverage` file exists locally but no thresholds or visibility.
- [ ] Deploy workflow has no rollback or pre-deploy migration check — Works today, fragile at scale.
- [ ] B2 backup upload is optional — Should be mandatory for prod or have a secondary strategy.
- [ ] Silent catch blocks in frontend hooks — `use-payment-data.ts` and onboarding swallow network errors silently.

## What's solid (no action needed)

- **Auth** — Token-based, OTP for public documents, email verification gate, RBAC across all views.
- **Money** — All Decimal, transaction.atomic() on every multi-write, quantize_money() everywhere, no floats.
- **Org scoping** — Verified: all 76 endpoints filter by organization_id. No cross-org leaks.
- **Frontend** — 28 pages, all rendering real content. Form validation comprehensive. Optional chaining throughout. Route params validated.
- **Test quality** — No no-op tests. Real behavioral contracts asserted. Full money-loop regression test.
- **Email pipeline** — Worker, Mailpit routing, Sentry on task failures all wired.
- **Push notifications** — Web Push working for document decisions.
- **Secrets hygiene** — Nothing hardcoded, .gitignore correct, prod startup validates config.

## Endpoint coverage summary

| Status | Description | Count |
|--------|-------------|-------|
| Fully tested | Auth, estimates, invoices, COs, payments, vendor bills, customers, projects, public signing | ~50 |
| Partially tested | Reporting, project cost codes | ~5 |
| Untested | Push (3), impersonate (3), org management (7), receipt scan (1), stores (1) | 15 |

## Notes

- Two "high risk" org-scoping claims from initial audit were verified as FALSE — payment_detail_view and project_accounting_export_view both correctly filter by organization_id.
- Receipt scan silent failure is the only confirmed code-level bug.
- CI runs: pip-audit, npm audit, backend tests, frontend lint + test + build. Missing: tsc --noEmit, Python linting, coverage.
