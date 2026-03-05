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
5. [ ] Invite registration race auto-detect — depends on #8 (email verification), bundle together
6. [x] Direct invoicing (`DIRECT` line type) — designed (decision record exists), not implemented
7. [x] Invoice/CO rail pagination not built

### Security
8. [ ] No email verification on registration
9. [ ] Registration email enumeration possible
10. [ ] No e-sign / PSK on public approval links

### Polish / UX
11. [ ] Onboarding guide arrows designed but not built
12. [ ] Nav overlap in 700–1400px viewport range
13. [ ] Pre-existing TS error in `change-order-public-preview.tsx:382`

### Architecture Debt
14. [ ] `FinancialAuditEvent` deprecation (5-phase plan, phase 0 only)
15. [ ] Django default `auth.User` instead of custom model
16. [ ] Missing immutable invoice/payment lifecycle capture models




