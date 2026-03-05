# Deferred: Invoice Rail Pagination

**Date:** 2026-03-01
**Status:** Deferred — not needed now, revisit when invoice volume per project warrants it.

## Context

The invoice rail displays all invoices for the selected project, filtered by status and an inline search bar. Since invoices are scoped per project and status filters default to active statuses (Draft, Sent, Partially Paid, Overdue), the visible set is small for typical usage.

## Current Mitigations

- **Status filters** default to active statuses only (Paid/Void hidden on load) — keeps the working set to invoices that need attention.
- **Inline search** lets users quickly find a specific invoice by number, amount, or date.
- **Project scoping** bounds the list to one project at a time.

## When to Revisit

If a single project accumulates enough invoices that the filtered rail becomes unwieldy (50+ visible cards after filtering), consider:

1. **Client-side pagination** — page through `searchedInvoices` in batches of 15-20. State: `invoicePage`, controls: Prev/Next with "N of M" label.
2. **Server-side pagination** — if the full fetch (`/projects/{id}/invoices/`) becomes slow. Requires API changes (`?page=N&page_size=20`).
3. **"Show more" progressive loading** — simpler UX than page controls, but DOM grows unbounded.

Option 1 is the lowest-effort path and was prototyped during this session (then removed as premature).
