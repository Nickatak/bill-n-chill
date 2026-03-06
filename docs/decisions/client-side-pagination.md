# Decision Record: Client-Side Pagination

Date: 2026-03-05
Status: Implemented

## Problem

Several list views (invoices, change orders) loaded all records at once and rendered them
in a single scrollable list. As record counts grew, this created two issues:

1. **DOM performance** — rendering hundreds of cards/rows degrades scroll performance
2. **Cognitive overload** — long unbroken lists are harder to scan than paged chunks

Server-side pagination was considered but rejected for MVP — the API already returns
project-scoped or status-filtered sets that are small enough to fetch in one request. The
bottleneck was rendering, not fetching.

## Decision

Implement a shared client-side pagination hook (`useClientPagination`) and a shared
`PaginationControls` component. Pages through already-fetched arrays in fixed-size batches.

### Why Client-Side Over Server-Side

- **Simpler:** No API changes, no cursor/offset parameters, no backend query changes.
- **Instant page transitions:** All data is already in memory. Page changes are a state
  update, not a network round-trip.
- **Filter-friendly:** Status filters, search, and pagination compose naturally — filter
  the array first, then paginate the result. No need to coordinate filter parameters with
  server pagination cursors.
- **Sufficient at current scale:** Invoice/CO lists are project-scoped and status-filtered.
  The working set is typically 5-30 items. Even the largest seed account (`late@test.com`)
  has manageable counts per project.

### When to Revisit for Server-Side

- If a single project accumulates 200+ invoices (unlikely for ICP)
- If the initial fetch becomes slow (>1s for the full list)
- If we add cross-project list views that aren't scoped to a single project

## Implementation

### Shared Hook: `useClientPagination`

Location: `shared/hooks/use-client-pagination.ts`

```typescript
function useClientPagination<T>(items: T[], pageSize?: number): {
  page: number;
  totalPages: number;
  totalCount: number;
  paginatedItems: T[];
  setPage: (page: number) => void;
}
```

- Default page size: 15
- Auto-resets to page 1 when the input array identity changes (filter/search update)
- Clamps page to valid range on item count changes

### Shared Component: `PaginationControls`

Location: `shared/components/pagination-controls.tsx`

Renders prev/next buttons with "Page X of Y (Z total)" label. Hidden when total pages ≤ 1.

### Current Usage

- **Invoices console** — paginates the filtered/searched invoice list in the rail
- **Change orders** — same pattern for the CO rail

Additional consoles (vendor bills, estimates) can adopt the same hook when needed.

## Tradeoffs

- **Chosen:** Shared hook + component for consistency across consoles. Single pattern,
  one place to update pagination UX.
- **Accepted limitation:** All data loaded upfront. Fine at current scale; won't scale to
  thousands of records without server-side pagination.
- **Rejected:** "Show more" progressive loading — DOM grows unbounded, no way to jump to
  a specific page range.

## Related

- Invoice console: `features/invoices/components/invoices-console.tsx`
- Shared hook: `shared/hooks/use-client-pagination.ts`
- Shared controls: `shared/components/pagination-controls.tsx`
- Original deferred doc: removed (superseded by this record)
