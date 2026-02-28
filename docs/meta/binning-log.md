# Docs Binning Log

Updated: 2026-02-28

## Bin Definitions
- `keep`: canonical docs we will maintain as-is (with minor updates).
- `maybe`: useful docs that likely need merge/split/rewrite before final placement.
- `toss`: docs to retire/archive after we extract anything still useful.
- `meta`: interview/bug-report/storytelling material and distilled architectural narratives.

## Decisions So Far
1. `api.md` -> `keep`
   - Actions: refreshed heading wording (`Core Health Endpoint`), added `Last reviewed: 2026-02-28`.
   - Binned copy: `docs/keep/api.md`.

2. `domain-model.md` -> `keep`
   - Actions: removed stale `v1 Draft` label, added `Last reviewed: 2026-02-28`, reframed API section as current snapshot with pointer to `docs/api.md`.
   - Binned copy: `docs/keep/domain-model.md`.

3. `architecture.md` -> `keep`
   - Actions: added `Last reviewed: 2026-02-28`; auth and theme-default drift already corrected earlier in this pass.
   - Binned copy: `docs/keep/architecture.md`.

4. `setup.md` -> `keep`
   - Actions: added `Last reviewed: 2026-02-28`.
   - Binned copy: `docs/keep/setup.md`.

5. `contributing.md` -> `keep`
   - Actions: added `Last reviewed: 2026-02-28`.
   - Binned copy: `docs/keep/contributing.md`.

6. `feature-list.md` -> `keep`
   - Actions: added `Last reviewed: 2026-02-28`; earlier stale `HANDOFF.md` pointer already removed.
   - Binned copy: `docs/keep/feature-list.md`.

7. `mvp-v1.md` -> `meta`
   - Actions: added `Last reviewed: 2026-02-28`.
   - Binned copy: `docs/meta/mvp-v1.md`.

8. `phase-2-operational-hardening-and-product-development.md` -> `maybe`
   - Actions: added `Last reviewed: 2026-02-28` and a status snapshot pointer to `work/for_me.md`.
   - Binned copy: `docs/maybe/phase-2-operational-hardening-and-product-development.md`.

9. `public-approval-workflows-decision-record.md` -> `meta`
   - Actions: no content changes (kept as an accepted decision record).
   - Binned copy: `docs/meta/public-approval-workflows-decision-record.md`.

10. `friends-testing-playbook.md` -> `maybe`
   - Actions: updated timestamp to `February 28, 2026`.
   - Binned copy: `docs/maybe/friends-testing-playbook.md`.

11. `pre-alpha-friend-testing-checklist.md` -> `toss`
   - Actions: no content edits in this pass.
   - Reason: overlapping checklist likely to merge into playbook, then retire.
   - Binned copy: `docs/toss/pre-alpha-friend-testing-checklist.md`.

12. `quick-add-ux-v2.md` -> `maybe`
   - Actions: added `Last reviewed: 2026-02-28`; earlier removed non-implemented `Merge into Existing` action.
   - Binned copy: `docs/maybe/quick-add-ux-v2.md`.

13. `orchestration.md` -> `keep`
   - Actions: added `Last reviewed: 2026-02-28`; earlier repo-name consistency fix applied.
   - Binned copy: `docs/keep/orchestration.md`.

14. `starter-cost-codes.md` -> `keep`
   - Actions: added `Last reviewed: 2026-02-28`.
   - Binned copy: `docs/keep/starter-cost-codes.md`.

15. `starter-cost-codes.csv` -> `keep`
   - Actions: no changes.
   - Binned copy: `docs/keep/starter-cost-codes.csv`.

16. `README.md` -> `keep`
   - Actions: removed deleted `HANDOFF.md` pointer earlier in this pass.
   - Binned copy: `docs/keep/README.md`.

## Meta Artifacts Added
- `docs/meta/architecture-storylines.md`
  - Purpose: interview/problem-story framing and reusable bug-report angle list.

## Additional Updates
- 2026-02-28: added `API Map Tree` to `docs/api.md` (and synced `docs/keep/api.md`) for faster endpoint discovery.
- 2026-02-28: grouped `docs/api.md` into two explicit bands: `API Foundations (Meta)` and `Endpoint Contracts (Spec)`, plus a dedicated `Auditability and Traceability Standards` section.
- 2026-02-28: expanded `architecture.md` with TOC, architecture snapshot diagram, runtime/deployment section, and reference-doc links (synced to `docs/keep/architecture.md`).
- 2026-02-28: added `Application Shape` map to `architecture.md` (backend shape, frontend shape, key runtime flows, invariant enforcement layers), synced to `docs/keep/architecture.md`.
- 2026-02-28: added full TOC to `contributing.md` for faster navigation (synced to `docs/keep/contributing.md`).
- 2026-02-28: regrouped `contributing.md` into two explicit bands: `Contribution Workflow and Code Style` and `Architecture and Modeling Conventions (Meta Choices)` (synced to `docs/keep/contributing.md`).
- 2026-02-28: restructured `domain-model.md` for reviewability with TOC + section bands (`Model Foundations`, `Entity Catalog`, `Relationship and Lifecycle Views`, `API Alignment and Open Questions`) and nested heading hierarchy; synced to `docs/keep/domain-model.md`.
- 2026-02-28: merged glossary + domain-model into a singular canonical source by adding `Domain Glossary (Canonical)` to `docs/domain-model.md` and converting `work/GLOSSARY.md` into a superseded pointer doc; synced to `docs/keep/domain-model.md`.
