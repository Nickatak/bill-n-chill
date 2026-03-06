## Nick's area (Keep this section at the top please)
- [x] Maybe intake doesn't need to be alone anymore: No create customer ability on customers page
- [x] Bug: Auto-Line loading is not working on invoice (reset works manually though).
- [ ] Explore: Maybe live-update was worth.
- [ ] Explore: Adding new line items on CO's.

- [ ] Manually test email functionality (it sends - I need to go through the flows though).
- [ ] Manually test RBAC.
- [ ] Manually test Payment Record Rewrite.


## Housekeeping Queue (from March 2026 audit)

### Pending (needs Nick's direction)
- [ ] **Type duplication across features** — `UserData` copy-pasted in 9 features, `ProjectRecord` in 6. No shared `@/types/domain.ts`. Low risk now, but every backend contract change hits up to 9 files.
- [ ] **Unrouted OTP view wrappers** — 6 thin wrappers in `backend/core/views/public_signing.py` not wired into `urls.py`. Helpers they wrap ARE used. Likely in-progress work from e-sign agent.
- [ ] **Missing domain-model.md entries** — `SigningCeremonyRecord`, `DocumentAccessSession` not documented. New models from e-sign work.
- [ ] **Missing docs** — Email verification endpoint contracts not in `api.md` (only in call-chains). CSS Modules composition pattern not in `contributing.md`.
