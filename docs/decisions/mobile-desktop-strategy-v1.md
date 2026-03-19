# Mobile and Desktop Strategy — Original v1 Approach (Superseded)

Date: 2026-02-28 (original)
Superseded: 2026-03-19 by `pwa-mobile-strategy.md`

## Status: Superseded

This was the original mobile/desktop split strategy shipped with the MVP plan. It assumed creation workflows (estimates, invoices, cost codes) were inherently desktop tasks, with mobile reserved for quick lookups and status checks.

This assumption was invalidated through real-world testing with a contractor. The revised direction is: **every flow must work on mobile.** See `pwa-mobile-strategy.md` for the rationale and replacement strategy.

## Original Strategy (preserved as-is)

- Product posture: mobile-first for in-field speed, desktop-first for complex editing and review.
- Mobile should optimize short, high-frequency actions (generally under 2 minutes).
- Desktop should optimize dense data workflows (tables, comparisons, multi-step edits).

Primary mobile workflows:
- Quick Add Customer with optional project shell.
- Field notes, status updates, and quick approvals.
- Fast invoice/bill/payment status checks.

Primary desktop workflows:
- Estimate authoring and revision.
- Cost-code management.
- Invoice composition, financial reconciliation, and reporting.

## Why it was wrong

The split assumed that document creation (estimates, invoices) is desk work. In practice, a GC finishes a job and needs to invoice the customer on the spot — not when they get home. Deferring creation to desktop meant deferring it indefinitely for users who don't sit at a desk.

The underlying issue was overestimating the ICP's willingness to context-switch between field and office workflows. For a 1–10 person GC, there is no "office workflow" — everything happens from the job site or the truck.

## What carried forward

- Theme requirements (dark/light mode, public pages forced light) remain unchanged.
- Desktop power-user density is still a goal — responsive doesn't mean dumbed-down. The change is that mobile is no longer a second-class path for any flow.
