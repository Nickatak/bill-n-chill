## Nick's area (Keep this section at the top please)
- [x] Maybe intake doesn't need to be alone anymore: No create customer ability on customers page
- [x] Bug: Auto-Line loading is not working on invoice (reset works manually though).
- [ ] Explore: Maybe live-update was worth.
- [ ] Explore: Adding new line items on CO's.

## MVP Gaps (triage list)

### Operational
1. [ ] CI/CD + prod deployment — purchase VPS, bring deployment into this repo, add GitHub Actions CI (bundle)
2. [x] `make local-test-frontend` only runs lint, doesn't run vitest

### Functional
4. [x] CSV `dry_run` string boolean bug — already fixed via `_parse_request_bool` helper
5. [x] Invite registration race auto-detect — depends on #8 (email verification), bundle together
6. [x] Direct invoicing (`DIRECT` line type) — designed (decision record exists), not implemented
7. [x] Invoice/CO rail pagination not built

### Security
8. [x] No email verification on registration
9. [x] Registration email enumeration possible
10. [ ] No e-sign / PSK on public approval links

### Polish / UX
11. [x] Onboarding guide arrows designed but not built
12. [x] Nav overlap in 700–1400px viewport range — concession: scrollbar at 701–850px, deferred (see `docs/deferred/DEFERRED_NAV_TABLET_OVERLAP.md`)
13. [x] Pre-existing TS error in `change-order-public-preview.tsx:382`

### Architecture Debt
14. [ ] `FinancialAuditEvent` deprecation (5-phase plan, phase 0 only)
15. [ ] Django default `auth.User` instead of custom model
16. [ ] Missing immutable invoice/payment lifecycle capture models

## Email Verification + Enumeration Fix (#8, #9, #5) — DONE

Decision doc: `docs/decisions/email-verification.md`

## Housekeeping Queue (from March 2026 audit)

### Pending (needs Nick's direction)
- [ ] **Type duplication across features** — `UserData` copy-pasted in 9 features, `ProjectRecord` in 6. No shared `@/types/domain.ts`. Low risk now, but every backend contract change hits up to 9 files.
- [ ] **Unrouted OTP view wrappers** — 6 thin wrappers in `backend/core/views/public_signing.py` not wired into `urls.py`. Helpers they wrap ARE used. Likely in-progress work from e-sign agent.
- [ ] **Missing domain-model.md entries** — `SigningCeremonyRecord`, `DocumentAccessSession` not documented. New models from e-sign work.
- [ ] **Missing docs** — Email verification endpoint contracts not in `api.md` (only in call-chains). CSS Modules composition pattern not in `contributing.md`.
